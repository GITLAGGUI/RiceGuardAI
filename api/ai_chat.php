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
if (!$data) {
    http_response_code(400);
    echo json_encode(["error" => "Valid JSON body is required."]);
    exit();
}

$prompt = trim((string)($data['prompt'] ?? ''));
$messages = $data['messages'] ?? [];
$context = is_array($data['context'] ?? null) ? $data['context'] : [];

if ($prompt === '' && empty($messages)) {
    http_response_code(400);
    echo json_encode(["error" => "Prompt or messages parameter is required."]);
    exit();
}

$result = riceguardGenerateRiceExpertResponse([
    'mode' => 'sms_draft',
    'prompt' => $prompt,
    'messages' => $messages,
    'disease' => $context['disease'] ?? '',
    'severity' => $context['severity'] ?? 'High',
    'location_text' => $context['location_text'] ?? '',
    'latitude' => $context['latitude'] ?? null,
    'longitude' => $context['longitude'] ?? null,
    'reasoning_effort' => $data['reasoning_effort'] ?? 'high',
]);

echo json_encode([
    "success" => true,
    "draft" => trim($result['content']),
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
