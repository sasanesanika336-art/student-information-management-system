const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema({
  studentId: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true },
  department: { type: String, required: true, trim: true },
  semester: { type: Number, required: true, min: 1 },
  contact: { type: String, required: true, trim: true }
});

module.exports = mongoose.model("Student", studentSchema);
