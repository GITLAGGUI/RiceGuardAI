<?php
/**
 * RiceGuard AI - Farmer API
 *
 * All endpoints require a valid Bearer token.
 *
 * Endpoints:
 *   GET  ?action=dashboard    — Get farmer profile + stats + recent alerts (single call)
 *   GET  ?action=alerts       — Get alert history for logged-in farmer
 *   GET  ?action=preferences  — Get notification preferences
 *   POST ?action=preferences  — Update notification preferences
 *   GET  ?action=profile      — Get farmer's full profile
 *   POST ?action=update_profile — Update farmer's name/location
 */

require_once __DIR__ . '/config.php';

// All endpoints require authentication
$farmer = requireAuth();
$farmerId = $farmer['id'];
$db = getDB();

$action = $_GET['action'] ?? '';

switch ($action) {

    /* ──────── DASHBOARD (one-call aggregation) ──────── */
    case 'dashboard':
        // Get recent alerts
        $stmt = $db->prepare(
            "SELECT id, disease, severity, location, advice, sent_at, delivery_status
             FROM alert_history WHERE farmer_id = ? ORDER BY sent_at DESC LIMIT 10"
        );
        $stmt->execute([$farmerId]);
        $recentAlerts = $stmt->fetchAll();

        // Get notification preferences
        $stmt = $db->prepare("SELECT sms_enabled, critical_alerts, weekly_summary FROM notification_preferences WHERE farmer_id = ?");
        $stmt->execute([$farmerId]);
        $prefs = $stmt->fetch();
        if (!$prefs) {
            $prefs = ['sms_enabled' => 1, 'critical_alerts' => 1, 'weekly_summary' => 0];
        }

        // Get alert stats
        $stmt = $db->prepare("SELECT COUNT(*) as total_alerts FROM alert_history WHERE farmer_id = ?");
        $stmt->execute([$farmerId]);
        $alertStats = $stmt->fetch();

        $stmt = $db->prepare(
            "SELECT COUNT(*) as critical_count FROM alert_history 
             WHERE farmer_id = ? AND severity IN ('Critical', 'High')"
        );
        $stmt->execute([$farmerId]);
        $criticalStats = $stmt->fetch();

        jsonResponse([
            'success' => true,
            'farmer' => $farmer,
            'recent_alerts' => $recentAlerts,
            'preferences' => $prefs,
            'stats' => [
                'total_alerts'  => (int)($alertStats['total_alerts'] ?? 0),
                'critical_alerts' => (int)($criticalStats['critical_count'] ?? 0),
            ]
        ]);
        break;

    /* ──────── ALERTS ──────── */
    case 'alerts':
        $stmt = $db->prepare(
            "SELECT id, disease, severity, location, advice, sent_at, delivery_status
             FROM alert_history WHERE farmer_id = ? ORDER BY sent_at DESC LIMIT 50"
        );
        $stmt->execute([$farmerId]);
        $alerts = $stmt->fetchAll();
        jsonResponse(['success' => true, 'alerts' => $alerts]);
        break;

    /* ──────── PREFERENCES (GET/POST) ──────── */
    case 'preferences':
        if ($_SERVER['REQUEST_METHOD'] === 'GET') {
            $stmt = $db->prepare("SELECT sms_enabled, critical_alerts, weekly_summary FROM notification_preferences WHERE farmer_id = ?");
            $stmt->execute([$farmerId]);
            $prefs = $stmt->fetch();

            if (!$prefs) {
                $db->prepare("INSERT INTO notification_preferences (farmer_id) VALUES (?)")->execute([$farmerId]);
                $prefs = ['sms_enabled' => 1, 'critical_alerts' => 1, 'weekly_summary' => 0];
            }

            jsonResponse(['success' => true, 'preferences' => $prefs]);
        } else {
            $body = getRequestBody();
            $smsEnabled = isset($body['sms_enabled']) ? (int)$body['sms_enabled'] : 1;
            $critical = isset($body['critical_alerts']) ? (int)$body['critical_alerts'] : 1;
            $weekly = isset($body['weekly_summary']) ? (int)$body['weekly_summary'] : 0;

            $stmt = $db->prepare(
                "INSERT INTO notification_preferences (farmer_id, sms_enabled, critical_alerts, weekly_summary)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE sms_enabled = VALUES(sms_enabled),
                 critical_alerts = VALUES(critical_alerts), weekly_summary = VALUES(weekly_summary)"
            );
            $stmt->execute([$farmerId, $smsEnabled, $critical, $weekly]);
            jsonResponse(['success' => true, 'message' => 'Preferences updated']);
        }
        break;

    /* ──────── PROFILE ──────── */
    case 'profile':
        jsonResponse(['success' => true, 'farmer' => $farmer]);
        break;

    /* ──────── UPDATE PROFILE ──────── */
    case 'update_profile':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonResponse(['error' => true, 'message' => 'POST method required'], 405);
        }

        $body = getRequestBody();
        $fullName     = trim($body['full_name'] ?? '');
        $province     = trim($body['province'] ?? '');
        $municipality = trim($body['municipality'] ?? '');
        $barangay     = trim($body['barangay'] ?? '');
        $farmSize     = $body['farm_size'] ?? null;

        if (!$fullName) {
            jsonResponse(['error' => true, 'message' => 'Full name is required'], 400);
        }

        $stmt = $db->prepare(
            "UPDATE farmers SET full_name = ?, province = ?, municipality = ?, barangay = ?, farm_size = ?
             WHERE id = ?"
        );
        $stmt->execute([$fullName, $province, $municipality, $barangay, $farmSize, $farmerId]);

        // Return updated profile
        $stmt = $db->prepare(
            "SELECT id, full_name, phone, role, province, municipality, barangay, farm_size, created_at
             FROM farmers WHERE id = ?"
        );
        $stmt->execute([$farmerId]);
        $updatedFarmer = $stmt->fetch();

        jsonResponse(['success' => true, 'message' => 'Profile updated', 'farmer' => $updatedFarmer]);
        break;

    /* ──────── LIST ALL FARMERS (admin only) ──────── */
    case 'list':
        if ($farmer['role'] !== 'admin') {
            jsonResponse(['error' => true, 'message' => 'Admin access required'], 403);
        }
        $stmt = $db->query(
            "SELECT id, full_name, phone, province, municipality, barangay, farm_size, is_active, created_at
             FROM farmers WHERE role = 'farmer' AND is_active = 1 ORDER BY full_name ASC"
        );
        $farmersList = $stmt->fetchAll();
        jsonResponse(['success' => true, 'farmers' => $farmersList]);
        break;

    default:
        jsonResponse(['error' => true, 'message' => 'Invalid action'], 400);
}
