
const mongoose = require("mongoose");
const Student = require("../models/Student");

// Add student
const addStudent = async (req, res) => {
  try {
    const { studentId, name, email, department, semester, contact } = req.body;

    if (![studentId, name, email, department, semester, contact]
      .every((v) => String(v ?? "").trim())) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const sem = Number(semester);
    if (!Number.isInteger(sem) || sem < 1 || sem > 8) {
      return res.status(400).json({ message: "Semester must be between 1 and 8." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Invalid email address." });
    }

    if (!/^\d{10}$/.test(String(contact).trim())) {
      return res.status(400).json({ message: "Contact must be 10 digits." });
    }

    const student = await Student.create({
      studentId: String(studentId).trim(),
      name: name.trim(),
      email: email.trim(),
      department: department.trim(),
      semester: sem,
      contact: String(contact).trim()
    });

    res.status(201).json({
      message: "Student added successfully.",
      student
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Student ID already exists." });
    }
    console.error("Add student error:", error);
    res.status(500).json({ message: "Failed to add student." });
  }
};

// View all students
const getStudents = async (req, res) => {
  try {
    const students = await Student.find().sort({ studentId: 1 });
    res.status(200).json(students);
  } catch (error) {
    console.error("Get students error:", error);
    res.status(500).json({ message: "Failed to fetch students." });
  }
};

// Search by Student ID (also accepts MongoDB document ID)
const getStudent = async (req, res) => {
  try {
    const searchValue = req.params.id.trim();

    let student = await Student.findOne({
      $or: [
        { studentId: { $regex: `^${searchValue}$`, $options: "i" } },
        { name: { $regex: searchValue, $options: "i" } },
        { email: { $regex: `^${searchValue}$`, $options: "i" } }
      ]
    });

    if (!student && /^[a-fA-F0-9]{24}$/.test(searchValue)) {
      student = await Student.findById(searchValue);
    }

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.status(200).json(student);
  } catch (error) {
    res.status(500).json({
      message: "Error searching for student",
      error: error.message
    });
  }
};

// Update by Student ID
const updateStudent = async (req, res) => {
  try {
    const id = req.params.id;
    const { name, email, department, semester, contact } = req.body;

    if (![name, email, department, semester, contact]
      .every((v) => String(v ?? "").trim())) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const sem = Number(semester);
    if (!Number.isInteger(sem) || sem < 1 || sem > 8) {
      return res.status(400).json({ message: "Semester must be between 1 and 8." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Invalid email address." });
    }

    if (!/^\d{10}$/.test(String(contact).trim())) {
      return res.status(400).json({ message: "Contact must be 10 digits." });
    }

    const student = await Student.findOneAndUpdate(
      { studentId: id },
      {
        name: name.trim(),
        email: email.trim(),
        department: department.trim(),
        semester: sem,
        contact: String(contact).trim()
      },
      { new: true, runValidators: true }
    );

    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    res.status(200).json({
      message: "Student updated successfully.",
      student
    });
  } catch (error) {
    console.error("Update student error:", error);
    res.status(500).json({ message: "Failed to update student." });
  }
};

// Delete by Student ID
const deleteStudent = async (req, res) => {
  try {
    const id = req.params.id;
    let student = await Student.findOneAndDelete({ studentId: id });

    if (!student && mongoose.isValidObjectId(id)) {
      student = await Student.findByIdAndDelete(id);
    }

    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    res.status(200).json({ message: "Student deleted successfully." });
  } catch (error) {
    console.error("Delete student error:", error);
    res.status(500).json({ message: "Failed to delete student." });
  }
};

module.exports = {
  addStudent,
  getStudents,
  getStudent,
  updateStudent,
  deleteStudent
};
