
import { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api/students";

const emptyForm = {
  studentId: "",
  name: "",
  email: "",
  department: "",
  semester: "",
  contact: ""
};

function App() {
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  const notify = (text, isError = false) => {
    setMessage(text);
    setError(isError);
  };

  const loadStudents = async () => {
    try {
      const res = await axios.get(API);
setStudents(Array.isArray(res.data) ? res.data : []);
    } catch {
      notify("Could not load students. Check the backend.", true);
    }
  };

  useEffect(() => {
    loadStudents();
  }, []);

  const change = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const reset = () => {
    setForm(emptyForm);
    setEditing(false);
  };

  const saveStudent = async (e) => {
    e.preventDefault();

    if (Object.values(form).some((v) => String(v).trim() === "")) {
      return notify("Please fill in all fields.", true);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      return notify("Enter a valid email address.", true);
    }

    if (!/^\d{10}$/.test(form.contact)) {
      return notify("Contact must contain exactly 10 digits.", true);
    }

    const data = { ...form, semester: Number(form.semester) };

    if (!Number.isInteger(data.semester) || data.semester < 1) {
      return notify("Enter a valid semester.", true);
    }

    try {
      if (editing) {
        await axios.put(`${API}/${encodeURIComponent(form.studentId)}`, data);
        notify("Student updated successfully.");
      } else {
        await axios.post(API, data);
        notify("Student added successfully.");
      }

      reset();
      await loadStudents();
    } catch (err) {
      notify(err.response?.data?.message || "Operation failed.", true);
    }
  };

  const editStudent = (student) => {
    setForm({
      studentId: student.studentId,
      name: student.name,
      email: student.email,
      department: student.department,
      semester: String(student.semester),
      contact: student.contact
    });
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteStudent = async (studentId) => {
    if (!window.confirm("Delete this student?")) return;

    try {
      await axios.delete(`${API}/${encodeURIComponent(studentId)}`);
      notify("Student deleted successfully.");
      await loadStudents();
    } catch (err) {
      notify(err.response?.data?.message || "Delete failed.", true);
    }
  };

  const searchStudent = async (e) => {
    e.preventDefault();
    if (!search.trim()) return loadStudents();

    try {
      const res = await axios.get(`${API}/${encodeURIComponent(search.trim())}`);

const result = res.data;
const studentList = Array.isArray(result)
  ? result
  : result && result.studentId
    ? [result]
    : [];

setStudents(studentList);
notify(studentList.length ? "Search completed." : "Student not found.", !studentList.length);
    } catch (err) {
      setStudents([]);
      notify(err.response?.data?.message || "Student not found.", true);
    }
  };

  return (
    <main className="container">
      <header>
        <h1>Student Information Management System</h1>
        <p>Manage student records in one place</p>
      </header>

      {message && (
        <div className={error ? "message error" : "message"}>
          {message}
          <button className="close" onClick={() => setMessage("")}>×</button>
        </div>
      )}

      <section className="panel">
        <h2>{editing ? "Update Student" : "Add Student"}</h2>
        <form onSubmit={saveStudent} className="student-form">
          {[
            ["studentId", "Student ID"],
            ["name", "Full Name"],
            ["email", "Email"],
            ["department", "Department"],
            ["semester", "Semester"],
            ["contact", "Contact Number"]
          ].map(([name, label]) => (
            <label key={name}>
              {label}
              <input
                name={name}
                value={form[name]}
                onChange={change}
                placeholder={`Enter ${label.toLowerCase()}`}
                type={name === "email" ? "email" : name === "semester" ? "number" : "text"}
                min={name === "semester" ? 1 : undefined}
                max={name === "semester" ? 8 : undefined}
                maxLength={name === "contact" ? 10 : undefined}
                disabled={editing && name === "studentId"}
                required
              />
            </label>
          ))}
          <div className="form-actions">
            <button type="submit">{editing ? "Update Student" : "Add Student"}</button>
            {editing && <button type="button" className="secondary" onClick={reset}>Cancel</button>}
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Student Records ({students.length})</h2>
        <form className="search-form" onSubmit={searchStudent}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Student ID"
          />
          <button type="submit">Search</button>
          <button type="button" className="secondary" onClick={() => {
            setSearch("");
            loadStudents();
          }}>View All</button>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Semester</th>
                <th>Contact</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s._id || s.studentId}>
                  <td>{s.studentId}</td>
                  <td>{s.name}</td>
                  <td>{s.email}</td>
                  <td>{s.department}</td>
                  <td>{s.semester}</td>
                  <td>{s.contact}</td>
                  <td className="actions">
                    <button onClick={() => editStudent(s)}>Edit</button>
                    <button className="danger" onClick={() => deleteStudent(s.studentId)}>Delete</button>
                  </td>
                </tr>
              ))}
              {students.length === 0 && (
                <tr><td colSpan="7" className="empty">No student records found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <footer>Student Information Management System</footer>
    </main>
  );
}

export default App;
