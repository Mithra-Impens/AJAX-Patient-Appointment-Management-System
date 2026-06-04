CREATE DATABASE clinics_db; 
USE clinics_db;

CREATE TABLE  
appointments ( 
    id INT PRIMARY KEY AUTO_INCREMENT, 
    patient_name VARCHAR(100) NOT NULL, 
    email VARCHAR(100) NOT NULL, 
    mobile VARCHAR(20) NOT NULL, 
    doctor_id INT NOT NULL DEFAULT 1, 
    appointment_date DATE NOT NULL, 
    appointment_time TIME NOT NULL, 
    status VARCHAR(20) NOT NULL DEFAULT 'Pending', 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ); 

CREATE TABLE  
 doctors ( 
    id INT PRIMARY KEY AUTO_INCREMENT, 
    name VARCHAR(100) NOT NULL, 
    specialization VARCHAR(100) NOT NULL, 
    max_appointments_per_day INT NOT NULL DEFAULT 10 );    
    
INSERT INTO doctors (
    name, specialization, max_appointments_per_day) 
    VALUES ('Dr. Ananya Krishnan', 'General Physician', 10), ('Dr. Rajesh Menon', 'Cardiologist', 8), ('Dr. Priya Nair', 'Dermatologist', 12), ('Dr. Suresh Babu', 'Orthopedic', 8), ('Dr. Meera Pillai', 'Pediatrician', 10); 
    
CREATE INDEX idx_doctor_date ON appointments(doctor_id, appointment_date); 
CREATE INDEX idx_booking ON appointments(doctor_id, appointment_date, appointment_time); 
ALTER TABLE appointments ADD UNIQUE (doctor_id, appointment_date, appointment_time );