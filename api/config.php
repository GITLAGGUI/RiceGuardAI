<?php
/**
 * RiceGuard AI - Database & SMS Configuration
 * 
 * Provides: DB connection, JSON helpers, phone normalization,
 *           token generation, and Bearer-token authentication middleware.
 */

// ============================================
// SETTINGS.JSON (For Shared Hosting)
// ============================================
$settingsFile = __DIR__ . '/settings.json';
$customSettings = [];
if (file_exists($settingsFile)) {
    $customSettings = json_decode(file_get_contents($settingsFile), true) ?? [];
}

// ============================================
// DATABASE
// ============================================
define('DB_HOST', $customSettings['db_host'] ?? getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', $customSettings['db_name'] ?? getenv('DB_NAME') ?: 'riceguardai_db');
define('DB_USER', $customSettings['db_user'] ?? getenv('DB_USER') ?: 'root');
define('DB_PASS', $customSettings['db_pass'] ?? getenv('DB_PASS') ?: '');

// ============================================
// SMS GATE API
// ============================================
define('SMS_API_URL', 'https://api.sms-gate.app/3rdparty/v1/messages');
define('SMS_USERNAME', $customSettings['sms_username'] ?? getenv('SMS_USERNAME') ?: '');
define('SMS_PASSWORD', $customSettings['sms_password'] ?? getenv('SMS_PASSWORD') ?: '');

// ============================================
// AUTH SETTINGS
// ============================================
define('OTP_LENGTH', 6);
define('OTP_EXPIRY_MINUTES', 5);
define('SESSION_TOKEN_LENGTH', 64);          // bytes → 128 hex chars
define('SESSION_EXPIRY_DAYS', 30);
define('OTP_RATE_LIMIT_PER_HOUR', 5);

// ============================================
// GLOBAL SETUP
// ============================================
date_default_timezone_set('Asia/Manila');

// CORS headers for React dev server
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ============================================
// DATABASE CONNECTION
// ============================================

/**
 * Get PDO database connection (singleton)
 */
function getDB() {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $pdo = new PDO(
                "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
                DB_USER,
                DB_PASS,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false,
                ]
            );
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => true, 'message' => 'Database connection failed']);
            error_log("[RiceGuard] DB Connection Error: " . $e->getMessage());
            exit;
        }

        try {
            ensureAuthSchema($pdo);
            ensureApplicationSchema($pdo);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => true, 'message' => 'Database schema update failed']);
            error_log("[RiceGuard] DB Schema Error: " . $e->getMessage());
            exit;
        }
    }
    return $pdo;
}

// ============================================
// RESPONSE HELPERS
// ============================================

/**
 * Send JSON response and exit
 */
function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data);
    exit;
}

/**
 * Get JSON request body
 */
function getRequestBody() {
    $input = file_get_contents('php://input');
    return json_decode($input, true) ?? [];
}

/**
 * Check whether a table exists in the current database.
 */
function schemaTableExists(PDO $db, $tableName) {
    $stmt = $db->prepare(
        "SELECT 1
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name = ?
         LIMIT 1"
    );
    $stmt->execute([$tableName]);
    return (bool)$stmt->fetchColumn();
}

/**
 * Check whether a column exists in a table.
 */
function schemaColumnExists(PDO $db, $tableName, $columnName) {
    $stmt = $db->prepare(
        "SELECT 1
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = ?
           AND column_name = ?
         LIMIT 1"
    );
    $stmt->execute([$tableName, $columnName]);
    return (bool)$stmt->fetchColumn();
}

// ============================================
// SCHEMA MIGRATION (auto-add columns on older DBs)
// ============================================

/**
 * Ensure auth-related schema additions exist on older databases.
 */
function ensureAuthSchema(PDO $db) {
    static $checked = false;
    if ($checked) {
        return;
    }

    if (schemaTableExists($db, 'farmers') && !schemaColumnExists($db, 'farmers', 'phone_verified')) {
        $db->exec("ALTER TABLE farmers ADD COLUMN phone_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER phone");
    }

    if (schemaTableExists($db, 'farmers') && !schemaColumnExists($db, 'farmers', 'role')) {
        $db->exec("ALTER TABLE farmers ADD COLUMN role ENUM('farmer', 'admin') NOT NULL DEFAULT 'farmer' AFTER phone_verified");
    }

    // Ensure sessions table exists
    $db->exec("CREATE TABLE IF NOT EXISTS `sessions` (
        `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        `farmer_id` INT UNSIGNED NOT NULL,
        `token` VARCHAR(128) NOT NULL UNIQUE,
        `expires_at` DATETIME NOT NULL,
        `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX `idx_token` (`token`),
        INDEX `idx_expires` (`expires_at`)
    ) ENGINE = InnoDB");

    // Ensure login_audit table exists
    $db->exec("CREATE TABLE IF NOT EXISTS `login_audit` (
        `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        `phone` VARCHAR(20) NOT NULL,
        `action` ENUM('otp_sent', 'otp_verified', 'login_success', 'login_failed') NOT NULL,
        `ip_address` VARCHAR(45) DEFAULT NULL,
        `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX `idx_phone_time` (`phone`, `created_at`)
    ) ENGINE = InnoDB");

    $checked = true;
}

/**
 * Ensure newer application fields exist for scan ingestion and map-ready detections.
 */
function ensureApplicationSchema(PDO $db) {
    static $checked = false;
    if ($checked) {
        return;
    }

    if (schemaTableExists($db, 'drone_scans')) {
        if (!schemaColumnExists($db, 'drone_scans', 'scan_name')) {
            $db->exec("ALTER TABLE drone_scans ADD COLUMN scan_name VARCHAR(150) NOT NULL DEFAULT '' AFTER admin_id");
        }
        if (!schemaColumnExists($db, 'drone_scans', 'source_type')) {
            $db->exec("ALTER TABLE drone_scans ADD COLUMN source_type ENUM('web_upload', 'manual_entry', 'mock', 'external_inference') NOT NULL DEFAULT 'web_upload' AFTER scan_name");
        }
        if (!schemaColumnExists($db, 'drone_scans', 'original_filename')) {
            $db->exec("ALTER TABLE drone_scans ADD COLUMN original_filename VARCHAR(255) DEFAULT NULL AFTER source_type");
        }
        if (!schemaColumnExists($db, 'drone_scans', 'stored_path')) {
            $db->exec("ALTER TABLE drone_scans ADD COLUMN stored_path VARCHAR(255) DEFAULT NULL AFTER original_filename");
        }
        if (!schemaColumnExists($db, 'drone_scans', 'mime_type')) {
            $db->exec("ALTER TABLE drone_scans ADD COLUMN mime_type VARCHAR(100) DEFAULT NULL AFTER stored_path");
        }
        if (!schemaColumnExists($db, 'drone_scans', 'file_size_bytes')) {
            $db->exec("ALTER TABLE drone_scans ADD COLUMN file_size_bytes BIGINT UNSIGNED DEFAULT NULL AFTER mime_type");
        }
        if (!schemaColumnExists($db, 'drone_scans', 'captured_at')) {
            $db->exec("ALTER TABLE drone_scans ADD COLUMN captured_at DATETIME DEFAULT NULL AFTER file_size_bytes");
        }
        if (!schemaColumnExists($db, 'drone_scans', 'processed_at')) {
            $db->exec("ALTER TABLE drone_scans ADD COLUMN processed_at DATETIME DEFAULT NULL AFTER scan_date");
        }
        if (!schemaColumnExists($db, 'drone_scans', 'notes')) {
            $db->exec("ALTER TABLE drone_scans ADD COLUMN notes TEXT DEFAULT NULL AFTER processed_at");
        }
    }

    if (schemaTableExists($db, 'disease_detections')) {
        if (!schemaColumnExists($db, 'disease_detections', 'location_text')) {
            $db->exec("ALTER TABLE disease_detections ADD COLUMN location_text VARCHAR(255) NOT NULL DEFAULT '' AFTER severity");
        }
        if (!schemaColumnExists($db, 'disease_detections', 'confidence_score')) {
            $db->exec("ALTER TABLE disease_detections ADD COLUMN confidence_score DECIMAL(5, 4) DEFAULT NULL AFTER longitude");
        }
        if (!schemaColumnExists($db, 'disease_detections', 'affected_area_pct')) {
            $db->exec("ALTER TABLE disease_detections ADD COLUMN affected_area_pct DECIMAL(6, 2) DEFAULT NULL AFTER confidence_score");
        }
        if (!schemaColumnExists($db, 'disease_detections', 'bbox_json')) {
            $db->exec("ALTER TABLE disease_detections ADD COLUMN bbox_json TEXT DEFAULT NULL AFTER affected_area_pct");
        }
        if (!schemaColumnExists($db, 'disease_detections', 'mask_path')) {
            $db->exec("ALTER TABLE disease_detections ADD COLUMN mask_path VARCHAR(255) DEFAULT NULL AFTER bbox_json");
        }
        if (!schemaColumnExists($db, 'disease_detections', 'meta_json')) {
            $db->exec("ALTER TABLE disease_detections ADD COLUMN meta_json LONGTEXT DEFAULT NULL AFTER mask_path");
        }
    }

    $checked = true;
}

// ============================================
// PHONE NORMALIZATION
// ============================================

/**
 * Normalize Philippine mobile numbers to +639XXXXXXXXX format.
 */
function normalizePhone($phone) {
    $digits = preg_replace('/\D+/', '', (string)$phone);

    if (strpos($digits, '63') === 0 && strlen($digits) === 12) {
        return '+' . $digits;
    }

    if (strpos($digits, '0') === 0 && strlen($digits) === 11) {
        return '+63' . substr($digits, 1);
    }

    if (strpos($digits, '9') === 0 && strlen($digits) === 10) {
        return '+63' . $digits;
    }

    return trim((string)$phone);
}

/**
 * Normalize OTP codes to numeric characters only.
 */
function normalizeOtpCode($code) {
    return preg_replace('/\D+/', '', (string)$code);
}

/**
 * Build equivalent PH mobile number formats for legacy DB compatibility.
 */
function getPhoneVariants($phone) {
    $normalized = normalizePhone($phone);
    $digits = preg_replace('/\D+/', '', $normalized);

    if (strpos($digits, '63') !== 0 || strlen($digits) !== 12) {
        return array_values(array_unique([trim((string)$phone), $normalized]));
    }

    $local10 = substr($digits, 2); // 9XXXXXXXXX
    $local11 = '0' . $local10;     // 09XXXXXXXXX

    return array_values(array_unique([
        '+' . $digits,
        $digits,
        $local11,
        $local10,
    ]));
}

// ============================================
// TOKEN & SESSION MANAGEMENT
// ============================================

/**
 * Generate a cryptographically secure session token
 */
function generateToken() {
    return bin2hex(random_bytes(SESSION_TOKEN_LENGTH));
}

/**
 * Create a session for a farmer, return the token
 */
function createSession($farmerId) {
    $db = getDB();
    $token = generateToken();
    $expiresAt = date('Y-m-d H:i:s', strtotime('+' . SESSION_EXPIRY_DAYS . ' days'));

    // Clean up any expired sessions for this farmer
    $db->prepare("DELETE FROM sessions WHERE farmer_id = ? AND expires_at < NOW()")->execute([$farmerId]);

    $stmt = $db->prepare("INSERT INTO sessions (farmer_id, token, expires_at) VALUES (?, ?, ?)");
    $stmt->execute([$farmerId, $token, $expiresAt]);

    return $token;
}

/**
 * Validate a Bearer token and return the farmer data, or null
 */
function getAuthenticatedFarmer() {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

    // Fallback for Apache if HTTP_AUTHORIZATION is stripped
    if (empty($header) && function_exists('apache_request_headers')) {
        $requestHeaders = apache_request_headers();
        $header = $requestHeaders['Authorization'] ?? $requestHeaders['authorization'] ?? '';
    }

    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
        return null;
    }

    $token = trim($matches[1]);
    if (empty($token)) {
        return null;
    }

    $db = getDB();
    $stmt = $db->prepare(
        "SELECT s.farmer_id, s.expires_at, 
                f.id, f.full_name, f.phone, f.role, f.province, f.municipality, 
                f.barangay, f.farm_size, f.phone_verified, f.created_at
         FROM sessions s
         JOIN farmers f ON f.id = s.farmer_id
         WHERE s.token = ? AND s.expires_at > NOW()
         LIMIT 1"
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();

    if (!$row) {
        return null;
    }

    return [
        'id'             => (int)$row['id'],
        'full_name'      => $row['full_name'],
        'phone'          => $row['phone'],
        'role'           => $row['role'],
        'province'       => $row['province'],
        'municipality'   => $row['municipality'],
        'barangay'       => $row['barangay'],
        'farm_size'      => $row['farm_size'],
        'phone_verified' => (int)$row['phone_verified'],
        'created_at'     => $row['created_at'],
    ];
}

/**
 * Require authentication — returns farmer data or sends 401 and exits
 */
function requireAuth() {
    $farmer = getAuthenticatedFarmer();
    if (!$farmer) {
        jsonResponse(['error' => true, 'message' => 'Not authenticated. Please log in.'], 401);
    }
    return $farmer;
}

/**
 * Require admin role
 */
function requireAdmin() {
    $farmer = requireAuth();
    if ($farmer['role'] !== 'admin') {
        jsonResponse(['error' => true, 'message' => 'Access denied. Admin role required.'], 403);
    }
    return $farmer;
}

// ============================================
// RATE LIMITING
// ============================================

/**
 * Check if a phone has exceeded OTP rate limit
 */
function isRateLimited($phone) {
    $db = getDB();
    ensureAuthSchema($db);

    $oneHourAgo = date('Y-m-d H:i:s', strtotime('-1 hour'));
    $stmt = $db->prepare(
        "SELECT COUNT(*) as cnt FROM login_audit 
         WHERE phone = ? AND action = 'otp_sent' AND created_at > ?"
    );
    $stmt->execute([normalizePhone($phone), $oneHourAgo]);
    $row = $stmt->fetch();

    return ($row['cnt'] ?? 0) >= OTP_RATE_LIMIT_PER_HOUR;
}

/**
 * Log an auth action for audit trail
 */
function logAuthAction($phone, $action) {
    $db = getDB();
    ensureAuthSchema($db);

    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $stmt = $db->prepare("INSERT INTO login_audit (phone, action, ip_address) VALUES (?, ?, ?)");
    $stmt->execute([normalizePhone($phone), $action, $ip]);
}
