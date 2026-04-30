<?php
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => true, 'message' => 'Method not allowed'], 405);
}

$admin = requireAdmin();
$db = getDB();

/**
 * Normalize truthy request flags.
 */
function riceguardScanBool($value) {
    return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) === true;
}

/**
 * Accept only supported scan source types.
 */
function riceguardNormalizeSourceType($value) {
    $value = trim((string)$value);
    $allowed = ['web_upload', 'manual_entry', 'mock', 'external_inference'];

    return in_array($value, $allowed, true) ? $value : '';
}

/**
 * Normalize scan status values.
 */
function riceguardNormalizeScanStatus($value) {
    $value = trim((string)$value);
    $allowed = ['pending', 'processing', 'completed', 'failed'];

    return in_array($value, $allowed, true) ? $value : 'pending';
}

/**
 * Normalize advisory severity labels.
 */
function riceguardNormalizeSeverityValue($value) {
    $value = strtolower(trim((string)$value));

    if ($value === 'high' || $value === 'severe' || $value === 'critical') {
        return 'High';
    }

    if ($value === 'medium' || $value === 'moderate') {
        return 'Medium';
    }

    return 'Low';
}

/**
 * Normalize optional datetime values to MySQL format.
 */
function riceguardNormalizeDateTimeValue($value) {
    $value = trim((string)$value);
    if ($value === '') {
        return null;
    }

    $timestamp = strtotime($value);
    if ($timestamp === false) {
        return null;
    }

    return date('Y-m-d H:i:s', $timestamp);
}

/**
 * Parse detections from JSON body or multipart fields.
 */
function riceguardParseDetectionsPayload($value) {
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        $value = is_array($decoded) ? $decoded : [];
    }

    if (!is_array($value)) {
        return [];
    }

    return array_values(array_filter($value, function ($item) {
        return is_array($item);
    }));
}

/**
 * Encode arrays/objects safely for storage.
 */
function riceguardEncodeJsonValue($value) {
    if ($value === null || $value === '') {
        return null;
    }

    if (is_string($value)) {
        return $value;
    }

    if (is_array($value) || is_object($value)) {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/**
 * Resolve JSON and multipart payloads into one request array.
 */
function riceguardResolveScanPayload() {
    $body = getRequestBody();
    $payload = is_array($body) ? $body : [];

    foreach ($_POST as $key => $value) {
        $payload[$key] = $value;
    }

    return $payload;
}

/**
 * Pick the first uploaded scan file, if any.
 */
function riceguardResolveUploadedScanFile() {
    foreach (['scan_file', 'image', 'file'] as $key) {
        if (isset($_FILES[$key]) && is_array($_FILES[$key])) {
            return $_FILES[$key];
        }
    }

    foreach ($_FILES as $file) {
        if (is_array($file)) {
            return $file;
        }
    }

    return null;
}

/**
 * Persist the uploaded scan file and return stored metadata.
 */
function riceguardStoreUploadedScanFile(array $file, $uploadDir) {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }

    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Upload failed with error code ' . (int)$file['error']);
    }

    $originalName = $file['name'] ?? 'scan-image';
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $allowedExtensions = ['jpg', 'jpeg', 'png', 'webp'];

    if (!in_array($extension, $allowedExtensions, true)) {
        throw new RuntimeException('Unsupported scan file type. Use JPG, PNG, or WEBP.');
    }

    if (!is_dir($uploadDir) && !mkdir($uploadDir, 0777, true) && !is_dir($uploadDir)) {
        throw new RuntimeException('Unable to create uploads directory.');
    }

    $safeBase = preg_replace('/[^A-Za-z0-9_\-]+/', '-', pathinfo($originalName, PATHINFO_FILENAME));
    $safeBase = trim((string)$safeBase, '-');
    if ($safeBase === '') {
        $safeBase = 'scan';
    }

    $storedFilename = date('Ymd_His') . '_' . $safeBase . '.' . $extension;
    $targetPath = $uploadDir . $storedFilename;

    if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
        throw new RuntimeException('Failed to store uploaded scan file.');
    }

    return [
        'original_filename' => $originalName,
        'stored_path' => '/uploads/scans/' . $storedFilename,
        'mime_type' => $file['type'] ?? null,
        'file_size_bytes' => isset($file['size']) ? (int)$file['size'] : null,
    ];
}

/**
 * Build demo detections for mock-mode scan runs.
 */
function riceguardBuildMockDetections(array $farmerIds, $defaultImageUrl, $defaultLocationText) {
    $diseases = ['Rice Blast', 'Bacterial Leaf Blight', 'Tungro'];
    $severities = ['Low', 'Medium', 'High'];
    $detections = [];
    $count = rand(3, 5);

    for ($i = 0; $i < $count; $i++) {
        $lat = 17.5 + (rand(0, 300) / 1000);
        $lon = 121.6 + (rand(0, 300) / 1000);

        $detections[] = [
            'farmer_id' => count($farmerIds) > 0 ? $farmerIds[array_rand($farmerIds)] : null,
            'disease' => $diseases[array_rand($diseases)],
            'severity' => $severities[array_rand($severities)],
            'location_text' => $defaultLocationText !== '' ? $defaultLocationText : 'Demo scan area',
            'latitude' => $lat,
            'longitude' => $lon,
            'confidence_score' => rand(72, 98) / 100,
            'affected_area_pct' => rand(5, 45),
            'image_url' => $defaultImageUrl,
            'bbox' => [
                'x' => rand(10, 300),
                'y' => rand(10, 300),
                'width' => rand(80, 220),
                'height' => rand(80, 220),
            ],
            'meta' => [
                'source' => 'mock_ai',
                'generated_at' => date('c'),
            ],
        ];
    }

    return $detections;
}

/**
 * Store one detection row linked to a scan.
 */
function riceguardInsertDetection(PDO $db, $scanId, array $detection, $defaultImageUrl, $defaultLocationText) {
    $disease = trim((string)($detection['disease'] ?? ''));
    if ($disease === '') {
        throw new InvalidArgumentException('Each detection requires a disease label.');
    }

    $latitude = isset($detection['latitude']) ? (float)$detection['latitude'] : null;
    $longitude = isset($detection['longitude']) ? (float)$detection['longitude'] : null;

    if ($latitude === null || $longitude === null) {
        throw new InvalidArgumentException('Each detection requires latitude and longitude.');
    }

    $locationText = trim((string)($detection['location_text'] ?? $defaultLocationText));
    $imageUrl = trim((string)($detection['image_url'] ?? $defaultImageUrl));
    $maskPath = trim((string)($detection['mask_path'] ?? ''));
    $farmerId = isset($detection['farmer_id']) && $detection['farmer_id'] !== '' ? (int)$detection['farmer_id'] : null;
    $confidenceScore = isset($detection['confidence_score']) && $detection['confidence_score'] !== ''
        ? round((float)$detection['confidence_score'], 4)
        : null;
    $affectedAreaPct = isset($detection['affected_area_pct']) && $detection['affected_area_pct'] !== ''
        ? round((float)$detection['affected_area_pct'], 2)
        : null;

    $stmt = $db->prepare(
        "INSERT INTO disease_detections (
            scan_id, farmer_id, disease, severity, location_text, latitude, longitude,
            confidence_score, affected_area_pct, bbox_json, mask_path, meta_json, image_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->execute([
        (int)$scanId,
        $farmerId,
        $disease,
        riceguardNormalizeSeverityValue($detection['severity'] ?? 'Low'),
        $locationText,
        $latitude,
        $longitude,
        $confidenceScore,
        $affectedAreaPct,
        riceguardEncodeJsonValue($detection['bbox'] ?? ($detection['bbox_json'] ?? null)),
        $maskPath !== '' ? $maskPath : null,
        riceguardEncodeJsonValue($detection['meta'] ?? ($detection['meta_json'] ?? null)),
        $imageUrl,
    ]);

    return [
        'id' => (int)$db->lastInsertId(),
        'scan_id' => (int)$scanId,
        'farmer_id' => $farmerId,
        'disease' => $disease,
        'severity' => riceguardNormalizeSeverityValue($detection['severity'] ?? 'Low'),
        'location_text' => $locationText,
        'latitude' => $latitude,
        'longitude' => $longitude,
        'confidence_score' => $confidenceScore,
        'affected_area_pct' => $affectedAreaPct,
        'image_url' => $imageUrl,
    ];
}

$payload = riceguardResolveScanPayload();
$mockAi = riceguardScanBool($payload['mock_ai'] ?? false);
$detectionsInput = riceguardParseDetectionsPayload($payload['detections'] ?? []);
$uploadedFile = riceguardResolveUploadedScanFile();
$uploadDir = __DIR__ . '/../uploads/scans/';
$fileMeta = $uploadedFile ? riceguardStoreUploadedScanFile($uploadedFile, $uploadDir) : null;

if (!$mockAi && !$uploadedFile && empty($detectionsInput)) {
    jsonResponse([
        'error' => true,
        'message' => 'Provide a scan file, detections payload, or mock_ai=true.',
    ], 400);
}

$locationText = trim((string)($payload['location_text'] ?? ''));
$capturedAt = riceguardNormalizeDateTimeValue($payload['captured_at'] ?? null);
$notes = trim((string)($payload['notes'] ?? ''));
$requestedSourceType = riceguardNormalizeSourceType($payload['source_type'] ?? '');

if ($requestedSourceType !== '') {
    $sourceType = $requestedSourceType;
} elseif ($mockAi) {
    $sourceType = 'mock';
} elseif (!empty($detectionsInput) && $uploadedFile) {
    $sourceType = 'external_inference';
} elseif (!empty($detectionsInput)) {
    $sourceType = 'manual_entry';
} else {
    $sourceType = 'web_upload';
}

$requestedStatus = riceguardNormalizeScanStatus($payload['status'] ?? '');
$status = !empty($detectionsInput) || $mockAi ? 'completed' : $requestedStatus;
if ($uploadedFile && empty($detectionsInput) && !$mockAi && $requestedStatus === 'pending') {
    $status = 'pending';
}

$scanName = trim((string)($payload['scan_name'] ?? ''));
if ($scanName === '') {
    if ($mockAi) {
        $scanName = 'Mock Scan ' . date('Y-m-d H:i:s');
    } elseif ($uploadedFile && !empty($uploadedFile['name'])) {
        $scanName = pathinfo($uploadedFile['name'], PATHINFO_FILENAME);
    } else {
        $scanName = 'Manual Scan ' . date('Y-m-d H:i:s');
    }
}

try {
    $db->beginTransaction();

    $processedAt = $status === 'completed' ? date('Y-m-d H:i:s') : null;
    $insertScan = $db->prepare(
        "INSERT INTO drone_scans (
            admin_id, scan_name, source_type, original_filename, stored_path, mime_type,
            file_size_bytes, captured_at, processed_at, notes, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $insertScan->execute([
        $admin['id'],
        $scanName,
        $sourceType,
        $fileMeta['original_filename'] ?? null,
        $fileMeta['stored_path'] ?? null,
        $fileMeta['mime_type'] ?? null,
        $fileMeta['file_size_bytes'] ?? null,
        $capturedAt,
        $processedAt,
        $notes !== '' ? $notes : null,
        $status,
    ]);

    $scanId = (int)$db->lastInsertId();

    if ($mockAi) {
        $farmerStmt = $db->query("SELECT id FROM farmers WHERE role = 'farmer' AND is_active = 1");
        $farmerIds = $farmerStmt->fetchAll(PDO::FETCH_COLUMN);
        $detectionsInput = riceguardBuildMockDetections(
            $farmerIds,
            $fileMeta['stored_path'] ?? '',
            $locationText
        );
    }

    $storedDetections = [];
    foreach ($detectionsInput as $detection) {
        $storedDetections[] = riceguardInsertDetection(
            $db,
            $scanId,
            $detection,
            $fileMeta['stored_path'] ?? '',
            $locationText
        );
    }

    if (!empty($storedDetections) && $status !== 'completed') {
        $status = 'completed';
        $processedAt = date('Y-m-d H:i:s');
        $db->prepare("UPDATE drone_scans SET status = ?, processed_at = ? WHERE id = ?")
            ->execute([$status, $processedAt, $scanId]);
    }

    $db->commit();

    jsonResponse([
        'error' => false,
        'message' => $status === 'pending'
            ? 'Scan uploaded and queued for processing.'
            : 'Scan processed successfully.',
        'scan_id' => $scanId,
        'status' => $status,
        'queued_for_processing' => $status === 'pending',
        'detections_count' => count($storedDetections),
        'detections' => $storedDetections,
        'scan' => [
            'id' => $scanId,
            'scan_name' => $scanName,
            'source_type' => $sourceType,
            'status' => $status,
            'stored_path' => $fileMeta['stored_path'] ?? null,
            'captured_at' => $capturedAt,
            'processed_at' => $processedAt,
            'notes' => $notes !== '' ? $notes : null,
        ],
    ]);
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }

    error_log('[RiceGuard] Upload Error: ' . $e->getMessage());
    jsonResponse([
        'error' => true,
        'message' => $e instanceof InvalidArgumentException || $e instanceof RuntimeException
            ? $e->getMessage()
            : 'Internal Server Error',
    ], $e instanceof InvalidArgumentException || $e instanceof RuntimeException ? 400 : 500);
}
