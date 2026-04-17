const defaultShiftMaster = {
  MEP: [
    { code: "G", start: "09:00", end: "18:00", overnight: false },
    { code: "A", start: "07:00", end: "14:00", overnight: false },
    { code: "B", start: "14:00", end: "21:00", overnight: false },
    { code: "C", start: "21:00", end: "07:00", overnight: true },
  ],
  SECURITY: [
    { code: "G", start: "09:00", end: "18:00", overnight: false },
    { code: "A4", start: "08:00", end: "20:00", overnight: false },
    { code: "C4", start: "20:00", end: "08:00", overnight: true },
  ],
  DRIVER: [
    { code: "A4", start: "08:00", end: "20:00", overnight: false },
    { code: "C4", start: "20:00", end: "08:00", overnight: true },
  ],
  HOUSEKEEPING: [
    { code: "G1", start: "09:00", end: "18:00", overnight: false },
    { code: "G2", start: "08:00", end: "17:00", overnight: false },
    { code: "A", start: "06:00", end: "15:00", overnight: false },
    { code: "B", start: "12:00", end: "21:00", overnight: false },
    { code: "C", start: "21:00", end: "06:00", overnight: true },
  ],
  LANDSCAPE: [{ code: "G", start: "09:00", end: "17:00", overnight: false }],
};

module.exports = {
  defaultShiftMaster,
  authEndpoints: ["/api-token-auth/", "/jwt-api-token-auth/"],
  employeeEndpoint: "/personnel/api/employees/",
  departmentEndpoint: "/personnel/api/departments/",
  transactionEndpoint: "/iclock/api/transactions/",
};
