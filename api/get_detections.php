<?php
require_once 'config.php';

// Allow only GET
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => true, 'message' => 'Method not allowed'], 405);
}

// Ensure the user is authenticated (can be farmer or admin)
$user = requireAuth();
$db = getDB();

try {
    if ($user['role'] === 'admin') {
        // Admin sees all detections
        $stmt = $db->query(
            "SELECT d.id, d.scan_id, d.farmer_id, d.disease, d.severity, d.location_text,
                    d.latitude, d.longitude, d.confidence_score, d.affected_area_pct,
                    d.bbox_json, d.mask_path, d.meta_json, d.image_url, d.created_at,
                    ds.scan_name, ds.source_type, ds.status AS scan_status, ds.captured_at, ds.processed_at, ds.scan_date,
                    f.full_name as farmer_name, f.phone as farmer_phone
             FROM disease_detections d
             LEFT JOIN drone_scans ds ON ds.id = d.scan_id
             LEFT JOIN farmers f ON d.farmer_id = f.id
             ORDER BY d.created_at DESC"
        );
        $detections = $stmt->fetchAll();
    } else {
        // Farmer only sees their own farm's detections
        $stmt = $db->prepare(
            "SELECT d.id, d.scan_id, d.farmer_id, d.disease, d.severity, d.location_text,
                    d.latitude, d.longitude, d.confidence_score, d.affected_area_pct,
                    d.bbox_json, d.mask_path, d.meta_json, d.image_url, d.created_at,
                    ds.scan_name, ds.source_type, ds.status AS scan_status, ds.captured_at, ds.processed_at, ds.scan_date
             FROM disease_detections d
             LEFT JOIN drone_scans ds ON ds.id = d.scan_id
             WHERE d.farmer_id = ?
             ORDER BY d.created_at DESC"
        );
        $stmt->execute([$user['id']]);
        $detections = $stmt->fetchAll();
    }

    jsonResponse([
        'error' => false,
        'data' => $detections
    ]);

} catch (Exception $e) {
    error_log("[RiceGuard] Get Detections Error: " . $e->getMessage());
    jsonResponse(['error' => true, 'message' => 'Internal Server Error'], 500);
}
