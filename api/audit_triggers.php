<?php
require_once __DIR__ . '/config.php';
$db = getDB();

echo "### TRIGGERS ###\n";
try {
    $stmt = $db->query("SHOW TRIGGERS");
    print_r($stmt->fetchAll(PDO::FETCH_ASSOC));
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}

echo "\n### CONSTRAINTS / KEYS ###\n";
try {
    $stmt = $db->query("SHOW CREATE TABLE farmers");
    print_r($stmt->fetch(PDO::FETCH_ASSOC));
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
