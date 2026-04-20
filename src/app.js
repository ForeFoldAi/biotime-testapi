const express = require("express");
const path = require("path");
const cors = require("cors");
const {
  upload,
  uploadShifts,
  uploadWeekoffs,
  uploadSchedules,
  uploadTimetables,
} = require("./controllers/uploadController");
const {
  generateReport,
  getLastReport,
  getEmployeeCheckinCheckout,
  downloadReportExcel,
} = require("./controllers/reportController");
const { login } = require("./controllers/authController");
const {
  getAllApiData,
  getAttendanceTableData,
  getDepartmentsData,
  getEmployeesData,
  getTransactionsData,
} = require("./controllers/apiDataController");
const { getResourceList } = require("./controllers/listController");
const {
  getEmployeeManagementData,
  saveEmployeeManagementData,
} = require("./controllers/employeeManagementController");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.post("/auth/login", login);

app.post("/upload/shifts", upload.single("file"), uploadShifts);
app.post("/upload/weekoffs", upload.single("file"), uploadWeekoffs);
app.post("/upload/schedules", upload.single("file"), uploadSchedules);
app.post("/upload/timetables", upload.single("file"), uploadTimetables);

app.get("/report", generateReport);
app.get("/report/last", getLastReport);
app.get("/report/download/:filename", downloadReportExcel);
app.get("/attendance/checkins", getEmployeeCheckinCheckout);
app.get("/api/data/employees", getEmployeesData);
app.get("/api/data/departments", getDepartmentsData);
app.get("/api/data/transactions", getTransactionsData);
app.get("/api/data/all", getAllApiData);
app.get("/api/table/attendance", getAttendanceTableData);
app.get("/api/list/:resource", getResourceList);
app.get("/employee-management/data", getEmployeeManagementData);
app.post("/employee-management/save", saveEmployeeManagementData);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.statusCode || error.status || 500).json({
    message: error.message || "Internal server error",
  });
});

module.exports = app;
