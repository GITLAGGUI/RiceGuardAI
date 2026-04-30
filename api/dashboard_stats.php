<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => true, 'message' => 'Method not allowed'], 405);
}

$user = requireAuth();
$db = getDB();

if ($user['role'] === 'admin') {
    // ── ADMIN STATS ──
    $farmerCount = $db->query("SELECT COUNT(*) FROM farmers WHERE role = 'farmer' AND is_active = 1")->fetchColumn();
    $scanCountMonth = $db->query("SELECT COUNT(*) FROM drone_scans WHERE MONTH(scan_date) = MONTH(NOW()) AND YEAR(scan_date) = YEAR(NOW())")->fetchColumn();
    $detectionCount = $db->query("SELECT COUNT(*) FROM disease_detections")->fetchColumn();
    $smsCount = $db->query("SELECT COUNT(*) FROM alert_history")->fetchColumn();
    $advisoryCount = $db->query("SELECT COUNT(*) FROM advisories WHERE admin_approved = 1")->fetchColumn();

    // Recent scans (last 5)
    $recentScans = $db->query("
        SELECT ds.id, ds.scan_name, ds.source_type, ds.status, ds.scan_date, ds.captured_at, ds.processed_at,
               COUNT(dd.id) as detection_count,
               f.full_name as admin_name
        FROM drone_scans ds
        LEFT JOIN disease_detections dd ON dd.scan_id = ds.id
        LEFT JOIN farmers f ON f.id = ds.admin_id
        GROUP BY ds.id
        ORDER BY ds.scan_date DESC
        LIMIT 5
    ")->fetchAll();

    // Disease breakdown
    $diseaseBreakdown = $db->query("
        SELECT disease, COUNT(*) as count, severity
        FROM disease_detections
        GROUP BY disease, severity
        ORDER BY count DESC
    ")->fetchAll();

    jsonResponse([
        'error' => false,
        'role' => 'admin',
        'data' => [
            'farmer_count' => (int)$farmerCount,
            'scan_count_month' => (int)$scanCountMonth,
            'detection_count' => (int)$detectionCount,
            'sms_count' => (int)$smsCount,
            'advisory_count' => (int)$advisoryCount,
            'recent_scans' => $recentScans,
            'disease_breakdown' => $diseaseBreakdown,
        ]
    ]);
} else {
    // ── FARMER STATS ──
    $farmerId = $user['id'];

    // Farm size from profile
    $farmSize = $user['farm_size'] ?? null;

    // Last scan date for this farmer
    $lastScan = $db->prepare("
        SELECT MAX(ds.scan_date) as last_scan
        FROM drone_scans ds
        JOIN disease_detections dd ON dd.scan_id = ds.id
        WHERE dd.farmer_id = ?
    ");
    $lastScan->execute([$farmerId]);
    $lastScanDate = $lastScan->fetchColumn();

    // Diseases found (active, most recent scan)
    $diseases = $db->prepare("
        SELECT dd.disease, dd.severity, dd.latitude, dd.longitude, dd.created_at
        FROM disease_detections dd
        WHERE dd.farmer_id = ?
        ORDER BY dd.created_at DESC
    ");
    $diseases->execute([$farmerId]);
    $diseaseList = $diseases->fetchAll();

    // Unique disease names
    $uniqueDiseases = array_unique(array_column($diseaseList, 'disease'));

    // Pending advisories count
    $pendingAdvisories = $db->prepare("
        SELECT COUNT(*) FROM advisories
        WHERE farmer_id = ? AND admin_approved = 1
    ");
    $pendingAdvisories->execute([$farmerId]);
    $advisoryCount = $pendingAdvisories->fetchColumn();

    // Notification count (unread - items in alert_history with no read marker)
    $notifCount = $db->prepare("SELECT COUNT(*) FROM alert_history WHERE farmer_id = ?");
    $notifCount->execute([$farmerId]);

    jsonResponse([
        'error' => false,
        'role' => 'farmer',
        'data' => [
            'farm_size' => $farmSize,
            'last_scan_date' => $lastScanDate,
            'diseases_found_count' => count($diseaseList),
            'diseases_found_names' => array_values($uniqueDiseases),
            'disease_list' => $diseaseList,
            'advisory_count' => (int)$advisoryCount,
            'notification_count' => (int)$notifCount->fetchColumn(),
        ]
    ]);
}
