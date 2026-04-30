<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => true, 'message' => 'Method not allowed'], 405);
}

$user = requireAuth();
$db = getDB();
$farmerId = $user['id'];

// Active detections for this farmer
$stmt = $db->prepare("
    SELECT dd.id, dd.disease, dd.severity, dd.latitude, dd.longitude, dd.created_at,
           ds.scan_date
    FROM disease_detections dd
    JOIN drone_scans ds ON ds.id = dd.scan_id
    WHERE dd.farmer_id = ?
    ORDER BY dd.created_at DESC
");
$stmt->execute([$farmerId]);
$activeAlerts = $stmt->fetchAll();

// Add human-readable location from farmer profile
$locationText = '';
if ($user['barangay']) $locationText .= 'Brgy. ' . $user['barangay'];
if ($user['municipality']) $locationText .= ', ' . $user['municipality'];
if ($user['province']) $locationText .= ', ' . $user['province'];

foreach ($activeAlerts as &$alert) {
    $alert['location_text'] = $locationText ?: "Lat: {$alert['latitude']}, Lon: {$alert['longitude']}";
}

// Past alert history (resolved/sent advisories)
$historyStmt = $db->prepare("
    SELECT ah.id, ah.disease, ah.severity, ah.location, ah.advice, ah.sent_at, ah.delivery_status
    FROM alert_history ah
    WHERE ah.farmer_id = ?
    ORDER BY ah.sent_at DESC
    LIMIT 20
");
$historyStmt->execute([$farmerId]);
$alertHistory = $historyStmt->fetchAll();

// Advisories for this farmer
$advStmt = $db->prepare("
    SELECT a.id, a.disease, a.severity, a.location_text, a.latitude, a.longitude,
           a.advice_text, a.ai_generated, a.sms_sent, a.website_url, a.created_at
    FROM advisories a
    WHERE a.farmer_id = ? AND a.admin_approved = 1
    ORDER BY a.created_at DESC
");
$advStmt->execute([$farmerId]);
$advisories = $advStmt->fetchAll();

jsonResponse([
    'error' => false,
    'data' => [
        'active_alerts' => $activeAlerts,
        'alert_history' => $alertHistory,
        'advisories' => $advisories,
        'farmer_location' => $locationText,
    ]
]);
