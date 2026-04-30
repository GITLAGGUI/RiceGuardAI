<?php
/**
 * RiceGuard AI - SMS Gateway Service
 * Uses SMS Gate API (api.sms-gate.app)
 */

require_once __DIR__ . '/config.php';

/**
 * Send an SMS via SMS Gate API
 * 
 * @param string $phone International format phone (e.g., +639XXXXXXXXX)
 * @param string $message Message content
 * @return array Response from API
 */
function sendSMS($phone, $message) {
    $url = SMS_API_URL;
    
    $payload = json_encode([
        'textMessage' => [
            'text' => $message
        ],
        'phoneNumbers' => [$phone],
        'priority' => 100,
        'withDeliveryReport' => true
    ]);

    // Debug Log: Request
    error_log("[RiceGuard SMS] Sending to $phone: $message");
    error_log("[RiceGuard SMS] Payload: $payload");

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Basic ' . base64_encode(SMS_USERNAME . ':' . SMS_PASSWORD)
        ],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_TIMEOUT => 30,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    // Debug Log: Response
    error_log("[RiceGuard SMS] HTTP Status: $httpCode");
    if ($error) {
        error_log("[RiceGuard SMS] CURL Error: $error");
        return ['success' => false, 'error' => $error];
    }
    error_log("[RiceGuard SMS] API Response: $response");

    $responseData = json_decode($response, true);

    return [
        'success' => $httpCode >= 200 && $httpCode < 300,
        'httpCode' => $httpCode,
        'response' => $responseData
    ];
}

/**
 * Generate and send OTP to a phone number
 */
function sendOTP($phone) {
    $db = getDB();
    $phone = normalizePhone($phone);
    
    // Generate OTP
    $code = str_pad(random_int(0, 999999), OTP_LENGTH, '0', STR_PAD_LEFT);
    $expiresAt = date('Y-m-d H:i:s', strtotime('+' . OTP_EXPIRY_MINUTES . ' minutes'));
    
    // Invalidate any existing unused OTPs for this phone
    $stmt = $db->prepare("UPDATE otp_codes SET used = 1 WHERE phone = ? AND used = 0");
    $stmt->execute([$phone]);
    
    // Store new OTP
    $stmt = $db->prepare("INSERT INTO otp_codes (phone, code, expires_at, used) VALUES (?, ?, ?, 0)");
    $stmt->execute([$phone, $code, $expiresAt]);
    
    // Send via SMS
    $message = "[RiceGuard AI] Your verification code is: {$code}. Valid for " . OTP_EXPIRY_MINUTES . " minutes. Do not share this code.";
    $result = sendSMS($phone, $message);

    return [
        'success' => (bool)($result['success'] ?? false),
        'httpCode' => $result['httpCode'] ?? null,
        'error' => $result['error'] ?? null,
    ];
}

/**
 * Verify an OTP code
 */
function verifyOTP($phone, $code) {
    $db = getDB();
    $now = date('Y-m-d H:i:s');
    $phone = normalizePhone($phone);
    $code = normalizeOtpCode($code);
    $phoneCandidates = getPhoneVariants($phone);

    if (count($phoneCandidates) === 0) {
        return ['valid' => false, 'reason' => 'invalid'];
    }

    $placeholders = implode(', ', array_fill(0, count($phoneCandidates), '?'));

    $stmt = $db->prepare(
        "SELECT id, phone, code, used, expires_at FROM otp_codes
         WHERE phone IN ($placeholders) AND code = ?
         ORDER BY id DESC LIMIT 1"
    );
    $params = array_merge($phoneCandidates, [$code]);
    $stmt->execute($params);
    $row = $stmt->fetch();

    if (!$row) return ['valid' => false, 'reason' => 'invalid'];
    if ((int)$row['used'] === 1) return ['valid' => false, 'reason' => 'used'];
    if ($row['expires_at'] <= $now) return ['valid' => false, 'reason' => 'expired', 'expires_at' => $row['expires_at'], 'server_now' => $now];

    $stmt = $db->prepare("UPDATE otp_codes SET used = 1 WHERE id = ? AND used = 0");
    $stmt->execute([$row['id']]);

    if ($stmt->rowCount() === 0) return ['valid' => false, 'reason' => 'used'];

    return ['valid' => true];
}

/**
 * Send a disease alert SMS to a farmer
 */
function sendDiseaseAlert($phone, $disease, $severity, $location, $advice) {
    $message = "[RiceGuard AI] ALERTO\n\n"
             . "Sakit: {$disease}\n"
             . "Severity: {$severity}\n"
             . "Lokasyon: {$location}\n\n"
             . "Payo: {$advice}\n\n"
             . "— RiceGuard AI / PhilRice";

    $result = sendSMS($phone, $message);
    return $result['success'] ?? false;
}

/**
 * Check if a farmer's notification preferences allow sending an alert
 */
function shouldSendAlert($farmerId, $severity = 'Critical') {
    $db = getDB();
    $stmt = $db->prepare("SELECT sms_enabled, critical_alerts, weekly_summary FROM notification_preferences WHERE farmer_id = ?");
    $stmt->execute([$farmerId]);
    $prefs = $stmt->fetch();

    if (!$prefs) return true; 
    if (!$prefs['sms_enabled']) return false; 
    if (strtolower($severity) === 'critical' && !$prefs['critical_alerts']) return false;

    return true;
}

// ============== API Endpoint Logic ==============
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = getRequestBody();
    $action = $data['action'] ?? '';

    if ($action === 'send_advisory') {
        $message = $data['message'] ?? '';
        $recipients = $data['recipients'] ?? [];
        
        if (empty($message) || empty($recipients)) {
            jsonResponse(['error' => true, 'message' => 'Message and recipients are required'], 400);
        }

        $results = [];
        $db = getDB();
        
        foreach ($recipients as $phone) {
            $normalizedPhone = normalizePhone($phone);
            $res = sendSMS($normalizedPhone, $message);
            
            // Look up farmer by phone to save in dashboard
            $stmt = $db->prepare("SELECT id FROM farmers WHERE phone = ? OR phone = ? LIMIT 1");
            $stmt->execute([$normalizedPhone, $phone]);
            $farmer = $stmt->fetch();
            
            if ($farmer) {
                // Save to alert_history for SMS preview
                try {
                    $hist = $db->prepare("INSERT INTO alert_history (farmer_id, phone, disease, severity, location, advice, delivery_status) VALUES (?, ?, 'General Advisory', 'Info', 'Admin Message', ?, 'sent')");
                    $hist->execute([$farmer['id'], $normalizedPhone, $message]);
                } catch(Exception $e) {}
                
                // Save to advisories for In-App Notification
                try {
                    $adv = $db->prepare("INSERT INTO advisories (admin_id, farmer_id, disease, severity, location_text, advice_text, ai_generated, admin_approved, sms_sent) VALUES (?, ?, 'General Advisory', 'Info', 'Admin Message', ?, 0, 1, 1)");
                    // Using 1 as default admin_id if not available
                    $adv->execute([1, $farmer['id'], $message]);
                } catch(Exception $e) {}
            }

            $results[] = [
                'phone' => $normalizedPhone,
                'success' => $res['success'] ?? false
            ];
        }

        jsonResponse([
            'success' => true,
            'message' => 'Advisories processed',
            'details' => $results
        ]);
    }
}
