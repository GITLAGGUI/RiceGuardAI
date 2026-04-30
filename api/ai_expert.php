<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Content-Type: application/json; charset=UTF-8");

require_once __DIR__ . '/ai_rice_expert.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$data = json_decode(file_get_contents("php://input"), true);
if (!$data || !isset($data['disease'])) {
    http_response_code(400);
    echo json_encode(["error" => "Disease parameter is required."]);
    exit();
}

$result = riceguardGenerateRiceExpertResponse([
    'mode' => 'field_advisory',
    'disease' => $data['disease'],
    'severity' => $data['severity'] ?? 'High',
    'admin_prompt' => $data['admin_prompt'] ?? '',
    'location_text' => $data['location_text'] ?? '',
    'latitude' => $data['latitude'] ?? null,
    'longitude' => $data['longitude'] ?? null,
    'reasoning_effort' => $data['reasoning_effort'] ?? 'high',
]);

echo json_encode([
    "success" => true,
    "advice" => trim($result['content']),
    "is_fallback" => $result['is_fallback'] ?? false,
    "provider" => $result['provider'] ?? null,
    "model" => $result['model'] ?? null,
    "reasoning_effort" => $result['reasoning_effort'] ?? null,
    "requested_reasoning_effort" => $result['requested_reasoning_effort'] ?? null,
    "recognized_disease" => $result['recognized_disease'] ?? null,
    "suggested_follow_ups" => $result['suggested_follow_ups'] ?? [],
    "weather" => $result['weather'] ?? null,
    "weather_warning" => $result['weather_warning'] ?? null,
    "warning" => $result['warning'] ?? null,
]);
?>
