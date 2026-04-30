<?php
require_once 'sms.php'; // includes config.php
require_once __DIR__ . '/ai_rice_expert.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => true, 'message' => 'Method not allowed'], 405);
}

$admin = requireAdmin();
$db = getDB();
$data = getRequestBody();

$action = $data['action'] ?? '';

// ── ACTION: AI COMPOSE ──
// Admin asks the AI to draft an advisory
if ($action === 'ai_compose') {
    $disease = $data['disease'] ?? '';
    $severity = $data['severity'] ?? 'High';
    $adminPrompt = $data['admin_prompt'] ?? '';
    $locationText = $data['location_text'] ?? '';
    $latitude = $data['latitude'] ?? null;
    $longitude = $data['longitude'] ?? null;

    if (empty($disease)) {
        jsonResponse(['error' => true, 'message' => 'Disease is required'], 400);
    }

    // Call ai_expert.php internally
    $aiPayload = [
        'disease' => $disease,
        'severity' => $severity,
        'admin_prompt' => $adminPrompt,
        'location_text' => $locationText,
        'latitude' => $latitude,
        'longitude' => $longitude,
    ];

    // Direct internal call to AI logic
    $aiResponse = callAIExpert($aiPayload);

    jsonResponse([
        'error' => false,
        'draft' => $aiResponse['advice'] ?? 'Hindi nakuha ang payo mula sa AI.',
        'is_fallback' => $aiResponse['is_fallback'] ?? true,
        'provider' => $aiResponse['provider'] ?? null,
        'model' => $aiResponse['model'] ?? null,
        'reasoning_effort' => $aiResponse['reasoning_effort'] ?? null,
        'requested_reasoning_effort' => $aiResponse['requested_reasoning_effort'] ?? null,
        'recognized_disease' => $aiResponse['recognized_disease'] ?? null,
        'suggested_follow_ups' => $aiResponse['suggested_follow_ups'] ?? [],
        'weather' => $aiResponse['weather'] ?? null,
        'weather_warning' => $aiResponse['weather_warning'] ?? null,
        'warning' => $aiResponse['warning'] ?? null,
    ]);
}

// ── ACTION: SEND ADVISORY ──
if ($action === 'send') {
    $farmerIds = $data['farmer_ids'] ?? [];
    $disease = $data['disease'] ?? '';
    $severity = $data['severity'] ?? '';
    $adviceText = $data['advice_text'] ?? '';
    $locationText = $data['location_text'] ?? '';
    $latitude = $data['latitude'] ?? null;
    $longitude = $data['longitude'] ?? null;
    $detectionId = $data['detection_id'] ?? null;
    $aiGenerated = $data['ai_generated'] ?? false;
    $websiteUrl = $data['website_url'] ?? 'http://localhost:5173/farmer/map';

    if (empty($farmerIds) || empty($disease) || empty($adviceText)) {
        jsonResponse(['error' => true, 'message' => 'farmer_ids, disease, and advice_text are required'], 400);
    }

    $results = [];

    foreach ($farmerIds as $fid) {
        // Get farmer phone and profile
        $fStmt = $db->prepare("SELECT id, full_name, phone, barangay, municipality, province FROM farmers WHERE id = ? AND is_active = 1");
        $fStmt->execute([$fid]);
        $farmer = $fStmt->fetch();

        if (!$farmer || empty($farmer['phone'])) {
            $results[] = ['farmer_id' => $fid, 'success' => false, 'reason' => 'Farmer not found or no phone'];
            continue;
        }

        // Build location string
        $farmerLoc = $locationText;
        if (empty($farmerLoc)) {
            $parts = [];
            if ($farmer['barangay']) $parts[] = 'Brgy. ' . $farmer['barangay'];
            if ($farmer['municipality']) $parts[] = $farmer['municipality'];
            if ($farmer['province']) $parts[] = $farmer['province'];
            $farmerLoc = implode(', ', $parts);
        }

        // Build the SMS message (NO emojis, plain text, offline-friendly)
        $coordsText = ($latitude && $longitude) ? "Coordinates: {$latitude}, {$longitude}" : '';
        $mapLink = $websiteUrl;

        $smsMessage = "[RiceGuard AI] ALERTO: {$disease} ({$severity}) na-detect sa {$farmerLoc}.\n\n"
                    . ($coordsText ? "{$coordsText}\n\n" : '')
                    . "Payo: {$adviceText}\n\n"
                    . "Detalye: {$mapLink}\n\n"
                    . "— RiceGuard AI / PhilRice";

        // Save advisory to DB
        try {
            $advStmt = $db->prepare("
                INSERT INTO advisories (admin_id, farmer_id, detection_id, disease, severity, location_text, latitude, longitude, advice_text, ai_generated, admin_approved, sms_sent, website_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
            ");
            $advStmt->execute([
                $admin['id'], $fid, $detectionId, $disease, $severity,
                $farmerLoc, $latitude, $longitude, $adviceText,
                $aiGenerated ? 1 : 0, $mapLink
            ]);
        } catch (Exception $e) {
            error_log("Failed to insert advisory: " . $e->getMessage());
        }

        // Save to alert_history
        try {
            $histStmt = $db->prepare("
                INSERT INTO alert_history (farmer_id, phone, disease, severity, location, advice, delivery_status)
                VALUES (?, ?, ?, ?, ?, ?, 'sent')
            ");
            $histStmt->execute([$fid, $farmer['phone'], $disease, $severity, $farmerLoc, $adviceText]);
        } catch (Exception $e) {
            error_log("Failed to insert alert_history: " . $e->getMessage());
        }

        // Send SMS
        $smsResult = sendSMS(normalizePhone($farmer['phone']), $smsMessage);

        // Update delivery status
        if ($smsResult['success']) {
            $db->prepare("UPDATE alert_history SET delivery_status = 'delivered' WHERE farmer_id = ? ORDER BY id DESC LIMIT 1")->execute([$fid]);
        }

        $results[] = [
            'farmer_id' => $fid,
            'farmer_name' => $farmer['full_name'],
            'success' => $smsResult['success'] ?? false,
            'sms_sent' => true,
        ];
    }

    jsonResponse([
        'error' => false,
        'message' => 'Advisories sent successfully.',
        'results' => $results,
    ]);
}

jsonResponse(['error' => true, 'message' => 'Invalid action. Use "ai_compose" or "send".'], 400);

// ── INTERNAL AI HELPER ──
function callAIExpert($params) {
    $result = riceguardGenerateRiceExpertResponse([
        'mode' => 'field_advisory',
        'disease' => $params['disease'] ?? '',
        'severity' => $params['severity'] ?? 'High',
        'admin_prompt' => $params['admin_prompt'] ?? '',
        'location_text' => $params['location_text'] ?? '',
        'latitude' => $params['latitude'] ?? null,
        'longitude' => $params['longitude'] ?? null,
        'reasoning_effort' => $params['reasoning_effort'] ?? 'high',
    ]);

    return [
        'advice' => trim($result['content'] ?? ''),
        'is_fallback' => $result['is_fallback'] ?? true,
        'provider' => $result['provider'] ?? null,
        'model' => $result['model'] ?? null,
        'reasoning_effort' => $result['reasoning_effort'] ?? null,
        'requested_reasoning_effort' => $result['requested_reasoning_effort'] ?? null,
        'recognized_disease' => $result['recognized_disease'] ?? null,
        'suggested_follow_ups' => $result['suggested_follow_ups'] ?? [],
        'weather' => $result['weather'] ?? null,
        'weather_warning' => $result['weather_warning'] ?? null,
        'warning' => $result['warning'] ?? null,
    ];
}
