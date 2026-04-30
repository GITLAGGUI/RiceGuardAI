<?php
/**
 * RiceGuard AI - System Settings API
 * Handles reading and updating the system configuration stored in settings.json
 */

require_once __DIR__ . '/config.php';
requireAuth(); // Must be logged in
requireAdmin(); // Must be an admin

$settingsFile = __DIR__ . '/settings.json';

// Ensure the file exists
if (!file_exists($settingsFile)) {
    $defaultSettings = [
        "system_name" => "RiceGuard AI Core v4",
        "environment" => "PRODUCTION",
        "sms_username" => "SOLRZV",
        "sms_password" => "2l8vi5achfxx5c"
    ];
    file_put_contents($settingsFile, json_encode($defaultSettings, JSON_PRETTY_PRINT));
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $settingsData = file_get_contents($settingsFile);
    $settings = json_decode($settingsData, true);
    
    jsonResponse([
        "success" => true,
        "settings" => $settings
    ]);
} 

elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = getRequestBody();
    
    // Validate inputs
    if (empty($data['system_name']) || empty($data['environment']) || empty($data['sms_username']) || empty($data['sms_password'])) {
        jsonResponse([
            "success" => false,
            "message" => "All fields are required."
        ], 400);
    }
    
    $newSettings = [
        "system_name" => htmlspecialchars($data['system_name']),
        "environment" => htmlspecialchars($data['environment']),
        "sms_username" => htmlspecialchars($data['sms_username']),
        "sms_password" => htmlspecialchars($data['sms_password'])
    ];
    
    if (file_put_contents($settingsFile, json_encode($newSettings, JSON_PRETTY_PRINT))) {
        jsonResponse([
            "success" => true,
            "message" => "Settings updated successfully.",
            "settings" => $newSettings
        ]);
    } else {
        jsonResponse([
            "success" => false,
            "message" => "Failed to save settings."
        ], 500);
    }
}
