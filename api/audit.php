<?php
require_once __DIR__ . '/config.php';
$db = getDB();

echo "### TABLE: farmers\n";
$stmt = $db->query("DESCRIBE farmers");
print_r($stmt->fetchAll(PDO::FETCH_ASSOC));

echo "\n### TABLE: otp_codes\n";
$stmt = $db->query("DESCRIBE otp_codes");
print_r($stmt->fetchAll(PDO::FETCH_ASSOC));

echo "\n### TIME SYNC\n";
echo "PHP Time: " . date('Y-m-d H:i:s') . "\n";
echo "PHP Timezone: " . date_default_timezone_get() . "\n";
$stmt = $db->query("SELECT NOW() as db_now");
$row = $stmt->fetch();
echo "DB Time: " . $row['db_now'] . "\n";
