<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => true, 'message' => 'Method not allowed'], 405);
}

$user = requireAuth();
$db = getDB();
$farmerId = $user['id'];

// In-app advisories (also contains SMS messages since we log both now)
$appStmt = $db->prepare("
    SELECT a.id, a.disease, a.severity, a.location_text as location, 
           a.advice_text as advice, a.created_at,
           CASE WHEN a.sms_sent = 1 THEN 'sms' ELSE 'advisory' END as type,
           a.website_url
    FROM advisories a
    WHERE a.farmer_id = ? AND a.admin_approved = 1 AND a.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    ORDER BY a.created_at DESC
    LIMIT 50
");
$appStmt->execute([$farmerId]);
$notifications = $appStmt->fetchAll();

// Get the latest SMS text that was sent (for SMS preview card)
$latestSms = $db->prepare("
    SELECT ah.disease, ah.severity, ah.location, ah.advice, ah.sent_at, ah.phone
    FROM alert_history ah
    WHERE ah.farmer_id = ?
    ORDER BY ah.sent_at DESC
    LIMIT 1
");
$latestSms->execute([$farmerId]);
$latestSmsData = $latestSms->fetch();

jsonResponse([
    'error' => false,
    'data' => [
        'notifications' => array_slice($notifications, 0, 30),
        'total_count' => count($notifications),
        'latest_sms' => $latestSmsData ?: null,
    ]
]);
