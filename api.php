<?php
session_start();
require_once 'config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }

// ── Helpers ────────────────────────────────────────────────────────────────

function sendJson($payload, $code = 200) {
    http_response_code($code);
    echo json_encode($payload);
    exit();
}

function sendError($msg, $code = 400) {
    sendJson(['success' => false, 'message' => $msg], $code);
}

function csrfGenerate() {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function csrfValidate($token) {
    return !empty($_SESSION['csrf_token'])
        && !empty($token)
        && hash_equals($_SESSION['csrf_token'], $token);
}

function getBody() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        sendError('Invalid JSON input', 400);
    }
    return $data;
}

function requireCsrf($data) {
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($data['csrf_token'] ?? '');
    if (!csrfValidate($token)) sendError('Invalid CSRF token', 403);
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateAppointment($data) {
    $errors = [];
    foreach (['patient_name','email','mobile','doctor_id','appointment_date','appointment_time'] as $f) {
        if (empty(trim($data[$f] ?? ''))) $errors[] = "$f is required";
    }
    if ($errors) return $errors;

    if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL))
        $errors[] = 'Invalid email format';

    $digits = preg_replace('/\D/', '', $data['mobile']);
    if (strlen($digits) !== 10)
        $errors[] = 'Mobile must be 10 digits';

    if (intval($data['doctor_id']) <= 0)
        $errors[] = 'Please select a doctor';

    if (($data['appointment_date'] ?? '') < date('Y-m-d'))
        $errors[] = 'Date cannot be in the past';

    return $errors;
}

// ── Route ──────────────────────────────────────────────────────────────────

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

switch ($method) {
    case 'GET':
        if ($action === 'csrf_token')  sendJson(['success' => true, 'token' => csrfGenerate()]);
        if ($action === 'doctors')     getDoctors($conn);
        if ($action === 'check_slots') checkSlots($conn);
        if ($action === 'get' && isset($_GET['id'])) getOne($conn, intval($_GET['id']));
        getAll($conn);
        break;

    case 'POST':
        $data = getBody(); requireCsrf($data);
        createAppointment($conn, $data);
        break;

    case 'PUT':
        $data = getBody(); requireCsrf($data);
        if ($action === 'status') updateStatus($conn, $data);
        else {
    updateAppointment($conn, $data);
}
        break;

    case 'DELETE':
        $data = getBody(); requireCsrf($data);
        deleteAppointment($conn, $data);
        break;

    default:
        sendError('Method not allowed', 405);
}

// ── CRUD Functions ─────────────────────────────────────────────────────────

function getAll($conn) {
    $sql = "SELECT a.*, d.name AS doctor_name, d.specialization
            FROM appointments a
            LEFT JOIN doctors d ON a.doctor_id = d.id
            ORDER BY a.appointment_date ASC, a.appointment_time ASC";
    $result = $conn->query($sql);
    if (!$result) sendError('Database error. Please try again later.', 500);

    $rows = [];
    while ($row = $result->fetch_assoc()) $rows[] = $row;
    sendJson(['success' => true, 'data' => $rows]);
}

function getOne($conn, $id) {
    $stmt = $conn->prepare(
        "SELECT a.*, d.name AS doctor_name, d.specialization
         FROM appointments a LEFT JOIN doctors d ON a.doctor_id = d.id
         WHERE a.id = ?"
    );
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    if (!$row) sendError('Appointment not found', 404);
    sendJson(['success' => true, 'data' => $row]);
}

function getDoctors($conn) {
    $result = $conn->query("SELECT * FROM doctors ORDER BY name ASC");
    if (!$result) sendError('Database error. Please try again later.', 500);
    $rows = [];
    while ($row = $result->fetch_assoc()) $rows[] = $row;
    sendJson(['success' => true, 'data' => $rows]);
}

function checkSlots($conn) {
    $docId = intval($_GET['doctor_id'] ?? 0);
    $date  = $_GET['date'] ?? '';
    if (!$docId || !$date) sendError('doctor_id and date required', 400);

    $stmt = $conn->prepare("SELECT max_appointments_per_day FROM doctors WHERE id = ?");
    $stmt->bind_param('i', $docId);
    $stmt->execute();
    $doc = $stmt->get_result()->fetch_assoc();
    if (!$doc) sendError('Doctor not found', 404);

    $stmt2 = $conn->prepare(
        "SELECT COUNT(*) AS cnt FROM appointments
         WHERE doctor_id = ? AND appointment_date = ? AND status != 'Cancelled'"
    );
    $stmt2->bind_param('is', $docId, $date);
    $stmt2->execute();
    $booked = $stmt2->get_result()->fetch_assoc()['cnt'];

    sendJson([
        'success'         => true,
        'available_slots' => $doc['max_appointments_per_day'] - $booked,
        'max_per_day'     => $doc['max_appointments_per_day'],
        'booked'          => $booked
    ]);
}

function createAppointment($conn, $data) {
    $errors = validateAppointment($data);
    if ($errors) sendError(implode(', ', $errors), 422);

    $name   = trim($data['patient_name']);
    $email  = trim($data['email']);
    $mobile = trim($data['mobile']);
    $docId  = intval($data['doctor_id']);
    $date   = $data['appointment_date'];
    $time   = $data['appointment_time'];

    checkTimeHour($time);
    checkDoubleBooking($conn, $docId, $date, $time);
    checkDailyLimit($conn, $docId, $date);

    $stmt = $conn->prepare(
        "INSERT INTO appointments (patient_name, email, mobile, doctor_id, appointment_date, appointment_time, status)
         VALUES (?, ?, ?, ?, ?, ?, 'Pending')"
    );
    $stmt->bind_param('sssiss', $name, $email, $mobile, $docId, $date, $time);

    if (!$stmt->execute()) sendError('Database error. Please try again later.', 500);
    sendJson(['success' => true, 'message' => 'Appointment booked successfully!', 'id' => $conn->insert_id]);
}

function updateAppointment($conn, $data) {
    $id = intval($data['id'] ?? 0);
    if (!$id) sendError('Appointment not found', 404);

    $errors = validateAppointment($data);
    if ($errors) sendError(implode(', ', $errors), 422);

    $name   = trim($data['patient_name']);
    $email  = trim($data['email']);
    $mobile = trim($data['mobile']);
    $docId  = intval($data['doctor_id']);
    $date   = $data['appointment_date'];
    $time   = $data['appointment_time'];

    checkTimeHour($time);
    checkDoubleBooking($conn, $docId, $date, $time, $id);
    checkDailyLimit($conn, $docId, $date, $id);

    $stmt = $conn->prepare(
        "UPDATE appointments SET patient_name=?, email=?, mobile=?, doctor_id=?,
         appointment_date=?, appointment_time=? WHERE id=?"
    );
    $stmt->bind_param('sssissi', $name, $email, $mobile, $docId, $date, $time, $id);

    if (!$stmt->execute())
        sendError('Database error. Please try again later.', 500);
    if ($stmt->affected_rows < 0) sendError('DB error', 500);
    sendJson(['success' => true, 'message' => 'Appointment updated successfully!']);
}

function updateStatus($conn, $data) {
    $id     = intval($data['id'] ?? 0);
    $status = trim($data['status'] ?? '');

    if (!$id) sendError('Appointment not found', 404);
    if (!in_array($status, ['Pending','Confirmed','Cancelled'])) sendError('Invalid status', 422);

    $stmt = $conn->prepare("UPDATE appointments SET status=? WHERE id=?");
    $stmt->bind_param('si', $status, $id);

    if (!$stmt->execute())
        sendError('Database error. Please try again later.', 500);
    if ($stmt->affected_rows < 0) sendError('DB error', 500);
    sendJson(['success' => true, 'message' => "Status updated to $status"]);
}

function deleteAppointment($conn, $data) {
    $id = intval($data['id'] ?? 0);
    if (!$id) sendError('Appointment not found', 404);

    $stmt = $conn->prepare("DELETE FROM appointments WHERE id=?");
    $stmt->bind_param('i', $id);

    if (!$stmt->execute())          sendError('Database error. Please try again later.', 500);
    if ($stmt->affected_rows === 0) sendError('Appointment not found', 404);
    sendJson(['success' => true, 'message' => 'Appointment deleted successfully!']);
}

// ── Business Rule Helpers ──────────────────────────────────────────────────

function checkTimeHour($time) {
    $hour = intval(explode(':', $time)[0]);
    if ($hour < 8 || $hour >= 20)
        sendError('Appointments must be between 08:00 AM and 08:00 PM.', 422);
}

function checkDoubleBooking($conn, $docId, $date, $time, $excludeId = 0) {
    $stmt = $conn->prepare(
        "SELECT id FROM appointments
         WHERE doctor_id=? AND appointment_date=? AND appointment_time=?
         AND status != 'Cancelled' AND id != ?"
    );
    $stmt->bind_param('issi', $docId, $date, $time, $excludeId);
    $stmt->execute();
    if ($stmt->get_result()->num_rows > 0)
        sendError('This time slot is already booked for the selected doctor. Choose a different time.', 409);
}

function checkDailyLimit($conn, $docId, $date, $excludeId = 0) {
    $stmt = $conn->prepare(
        "SELECT COUNT(*) AS cnt FROM appointments
         WHERE doctor_id=? AND appointment_date=? AND status != 'Cancelled' AND id != ?"
    );
    $stmt->bind_param('isi', $docId, $date, $excludeId);
    $stmt->execute();
    $count = $stmt->get_result()->fetch_assoc()['cnt'];

    $stmtMax = $conn->prepare("SELECT max_appointments_per_day FROM doctors WHERE id=?");
    $stmtMax->bind_param('i', $docId);
    $stmtMax->execute();
    $max = $stmtMax->get_result()->fetch_assoc()['max_appointments_per_day'] ?? 10;

    if ($count >= $max)
        sendError('This doctor has reached the daily appointment limit.', 409);
}
?>