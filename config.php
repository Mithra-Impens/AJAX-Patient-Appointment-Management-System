<?php
define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'clinics_db');

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);

if ($conn->connect_error) {
    http_response_code(500);
    header('Content-Type: application/json');
    error_log('DB connection failed: ' . $conn->connect_error); // logs to server, not client
    echo json_encode(['success' => false, 'message' => 'Service unavailable. Please try again later.']);
    exit();
}

$conn->set_charset('utf8mb4');
?>