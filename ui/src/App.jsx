import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Loader2,
  LogIn,
  RefreshCw,
  Save,
  Upload,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEFAULT_COMPANY = "auinfocity.itimedev.minervaiot.com";
const WEEK_DAY_OPTIONS = [
  { key: "monday", shortLabel: "Mon" },
  { key: "tuesday", shortLabel: "Tue" },
  { key: "wednesday", shortLabel: "Wed" },
  { key: "thursday", shortLabel: "Thu" },
  { key: "friday", shortLabel: "Fri" },
  { key: "saturday", shortLabel: "Sat" },
  { key: "sunday", shortLabel: "Sun" },
];

function formatCellValue(column, value) {
  if (value === null || value === undefined) return "";
  if (column !== "check_in" && column !== "check_out") return String(value);

  const text = String(value).trim();
  const match = text.match(/(\d{2}:\d{2}(:\d{2})?)/);
  return match ? match[1] : text;
}

function StatusBanner({ text, type }) {
  const classes = {
    idle: "border-border bg-muted text-muted-foreground",
    loading: "border-primary/30 bg-primary/10 text-primary",
    success: "border-emerald-300 bg-emerald-50 text-emerald-700",
    error: "border-red-300 bg-red-50 text-red-700",
  };
  const Icon = type === "error" ? AlertTriangle : type === "success" ? CheckCircle2 : type === "loading" ? Loader2 : Clock3;

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${classes[type] || classes.idle}`}>
      <Icon className={`h-4 w-4 ${type === "loading" ? "animate-spin" : ""}`} />
      <span>{text}</span>
    </div>
  );
}

function EmployeeImportModal({
  open,
  files,
  importing,
  onClose,
  onFileChange,
  onImport,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
      <Card className="w-full max-w-2xl border-primary/20 bg-card shadow-glow">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Import Employee Management Files</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={importing}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Shift Details File</Label>
              <Input type="file" onChange={(event) => onFileChange("shifts", event.target.files?.[0] || null)} />
              {files.shifts ? <p className="text-xs text-secondary">{files.shifts.name}</p> : null}
            </div>
            <div className="space-y-2">
              <Label>Shift Timetable File</Label>
              <Input type="file" onChange={(event) => onFileChange("timetables", event.target.files?.[0] || null)} />
              {files.timetables ? <p className="text-xs text-secondary">{files.timetables.name}</p> : null}
            </div>
            <div className="space-y-2">
              <Label>Schedules File</Label>
              <Input type="file" onChange={(event) => onFileChange("schedules", event.target.files?.[0] || null)} />
              {files.schedules ? <p className="text-xs text-secondary">{files.schedules.name}</p> : null}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={importing}>
              Cancel
            </Button>
            <Button onClick={onImport} disabled={importing}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Import
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DataTable({ rows, title, groupedByDepartment = false, columns: explicitColumns = null }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm text-muted-foreground">No rows found.</div>;
  }

  const columns = Array.isArray(explicitColumns) && explicitColumns.length > 0 ? explicitColumns : Object.keys(rows[0]);
  const header = (
    <thead className="bg-muted/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
      <tr>
        {columns.map((column) => (
          <th key={column} className="px-3 py-2">
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );

  const renderRow = (row, index) => (
    <tr key={`${row.employee_code || "row"}-${row.date || index}`} className="border-b border-border/60 hover:bg-muted/30">
      {columns.map((column) => (
        <td key={`${column}-${index}`} className="px-3 py-2 text-xs text-card-foreground">
          {formatCellValue(column, row[column])}
        </td>
      ))}
    </tr>
  );

  if (!groupedByDepartment) {
    return (
      <div className="space-y-3">
        <div className="text-base font-semibold text-foreground">{title}</div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-max border-collapse">{header}<tbody>{rows.map(renderRow)}</tbody></table>
        </div>
      </div>
    );
  }

  const groupedDepartments = rows.reduce((acc, row) => {
    const department = row.department || "UNASSIGNED";
    if (!acc[department]) acc[department] = [];
    acc[department].push(row);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="text-base font-semibold text-foreground">{title}</div>
      {Object.entries(groupedDepartments)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([department, departmentRows]) => {
          const groupedByPosition = departmentRows.reduce((acc, row) => {
            const position = row.position || "UNASSIGNED";
            if (!acc[position]) acc[position] = [];
            acc[position].push(row);
            return acc;
          }, {});

          return (
            <Card key={department} className="border-border/80 bg-card/90">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Department: {department}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-max border-collapse">
                    {header}
                    <tbody>
                      {Object.entries(groupedByPosition)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .flatMap(([position, positionRows]) => {
                          const sortedRows = [...positionRows].sort((a, b) => {
                            if ((a.employee_code || "") === (b.employee_code || "")) {
                              return String(a.date || "").localeCompare(String(b.date || ""));
                            }
                            return String(a.employee_code || "").localeCompare(String(b.employee_code || ""));
                          });

                          const positionHeader = (
                            <tr key={`${department}-${position}`} className="bg-secondary/20">
                              <td className="px-3 py-2 text-xs font-semibold text-foreground" colSpan={columns.length}>
                                Position: {position}
                              </td>
                            </tr>
                          );
                          return [positionHeader, ...sortedRows.map(renderRow)];
                        })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
}

function App() {
  const today = useMemo(() => new Date(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [year, setYear] = useState(String(today.getFullYear()));
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [statusText, setStatusText] = useState("Please login to continue.");
  const [statusType, setStatusType] = useState("idle");
  const [rawJson, setRawJson] = useState(null);
  const [tableData, setTableData] = useState(null);
  const [excelMeta, setExcelMeta] = useState(null);
  const [activeTab, setActiveTab] = useState("employee-management");
  const [employeeRows, setEmployeeRows] = useState([]);
  const [employeeFilters, setEmployeeFilters] = useState({
    areas: [],
    departments: [],
    shift_details: [],
  });
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [reportAreaFilter, setReportAreaFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const [isRefreshingEmployees, setIsRefreshingEmployees] = useState(false);
  const [isSavingEmployees, setIsSavingEmployees] = useState(false);
  const [importFiles, setImportFiles] = useState({
    shifts: null,
    timetables: null,
    schedules: null,
  });
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const employeeGridRef = useRef(null);

  useEffect(() => {
    if (!statusText || statusType === "loading") return undefined;
    const timer = setTimeout(() => {
      setStatusType("idle");
      setStatusText("");
    }, 2000);
    return () => clearTimeout(timer);
  }, [statusText, statusType]);

  function clearDataViews() {
    setRawJson(null);
    setTableData(null);
    setExcelMeta(null);
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Request failed");
    return data;
  }

  const filteredEmployeeRows = useMemo(() => {
    const term = employeeSearch.trim().toLowerCase();
    return employeeRows.filter((row) => {
      const matchesSearch =
        !term ||
        String(row.employee_id).toLowerCase().includes(term) ||
        String(row.employee_name).toLowerCase().includes(term) ||
        String(row.area).toLowerCase().includes(term) ||
        String(row.department).toLowerCase().includes(term) ||
        String(row.shift_details).toLowerCase().includes(term);
      const matchesArea = areaFilter === "all" || row.area === areaFilter;
      const matchesDepartment = departmentFilter === "all" || row.department === departmentFilter;
      const matchesShift = shiftFilter === "all" || row.shift_details === shiftFilter;
      return matchesSearch && matchesArea && matchesDepartment && matchesShift;
    });
  }, [employeeRows, employeeSearch, areaFilter, departmentFilter, shiftFilter]);

  const employeeStats = useMemo(() => {
    const total = employeeRows.length;
    const assigned = employeeRows.filter((row) => Boolean(row.week_off)).length;
    const unassigned = Math.max(0, total - assigned);
    const showing = filteredEmployeeRows.length;
    return { total, assigned, unassigned, showing };
  }, [employeeRows, filteredEmployeeRows]);

  async function fetchEmployeeManagementRows() {
    setIsRefreshingEmployees(true);
    setStatusType("loading");
    setStatusText("Loading employee management data...");
    try {
      const data = await fetchJson("/employee-management/data");
      setEmployeeRows(Array.isArray(data.rows) ? data.rows : []);
      setEmployeeFilters(
        data.filters || {
          areas: [],
          departments: [],
          shift_details: [],
        }
      );
      setSelectedEmployeeIds([]);
      setLastSelectedIndex(null);
      setStatusType("success");
      setStatusText(`Loaded ${data.total || 0} employees.`);
    } catch (error) {
      setStatusType("error");
      setStatusText(error.message || "Failed to load employee management data.");
    } finally {
      setIsRefreshingEmployees(false);
    }
  }

  useEffect(() => {
    if (isAuthenticated && activeTab === "employee-management" && employeeRows.length === 0) {
      fetchEmployeeManagementRows();
    }
  }, [isAuthenticated, activeTab]);

  function setImportFile(key, file) {
    setImportFiles((prev) => ({ ...prev, [key]: file }));
  }

  async function handleImportFiles() {
    const entries = Object.entries(importFiles).filter(([, file]) => file);
    if (entries.length === 0) {
      setStatusType("error");
      setStatusText("Choose at least one file to import.");
      return;
    }

    const endpointMap = {
      shifts: "/upload/shifts",
      timetables: "/upload/timetables",
      schedules: "/upload/schedules",
    };

    setIsImportingFiles(true);
    try {
      for (const [key, file] of entries) {
        const formData = new FormData();
        formData.append("file", file);
        await fetchJson(endpointMap[key], { method: "POST", body: formData });
      }
      setStatusType("success");
      setStatusText("Import completed and stored locally.");
      setShowImportModal(false);
      setImportFiles({
        shifts: null,
        timetables: null,
        schedules: null,
      });
      await fetchEmployeeManagementRows();
    } catch (error) {
      setStatusType("error");
      setStatusText(error.message || "Import failed.");
    } finally {
      setIsImportingFiles(false);
    }
  }

  function handleEmployeeRowClick(event, row, index) {
    const id = row.employee_id;
    const idSet = new Set(selectedEmployeeIds);

    if (event.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const rangeIds = filteredEmployeeRows.slice(start, end + 1).map((item) => item.employee_id);
      if (event.metaKey || event.ctrlKey) {
        rangeIds.forEach((rangeId) => idSet.add(rangeId));
      } else {
        setSelectedEmployeeIds(rangeIds);
        return;
      }
    } else if (event.metaKey || event.ctrlKey) {
      if (idSet.has(id)) idSet.delete(id);
      else idSet.add(id);
    } else {
      setSelectedEmployeeIds([id]);
      setLastSelectedIndex(index);
      return;
    }

    setSelectedEmployeeIds([...idSet]);
    setLastSelectedIndex(index);
  }

  function assignWeekOff(day, row) {
    const selectedRows = filteredEmployeeRows.filter((item) =>
      selectedEmployeeIds.includes(item.employee_id)
    );
    const canBulkAssign = selectedRows.length > 1 && selectedEmployeeIds.includes(row.employee_id);
    const targetIds = canBulkAssign
      ? selectedRows
          .filter((item) => item.has_day_selectors)
          .map((item) => item.employee_id)
      : row.has_day_selectors
      ? [row.employee_id]
      : [];

    if (targetIds.length === 0) {
      setStatusType("error");
      setStatusText("Security department rows do not support weekly off day selectors.");
      return;
    }

    setEmployeeRows((prev) =>
      prev.map((item) => {
        if (!targetIds.includes(item.employee_id)) return item;
        const nextWeekDays = WEEK_DAY_OPTIONS.reduce((acc, option) => {
          acc[option.key] = option.key === day;
          return acc;
        }, {});
        return {
          ...item,
          week_off: day,
          week_days: nextWeekDays,
        };
      })
    );
    setStatusType("success");
    setStatusText(
      canBulkAssign
        ? `Assigned ${day} to ${targetIds.length} employees.`
        : `Assigned ${day} to ${row.employee_name}.`
    );
  }

  function handleEmployeeGridKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelectedEmployeeIds(filteredEmployeeRows.map((row) => row.employee_id));
      setStatusType("success");
      setStatusText(`Selected ${filteredEmployeeRows.length} employees.`);
    }
  }

  async function handleSaveEmployeeChanges() {
    setIsSavingEmployees(true);
    setStatusType("loading");
    setStatusText("Saving employee management changes...");
    try {
      const rowsToSave = employeeRows
        .filter((row) => row.has_day_selectors && row.week_off)
        .map((row) => ({
          employee_id: row.employee_id,
          week_off: row.week_off,
        }));
      const data = await fetchJson("/employee-management/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToSave }),
      });
      setStatusType("success");
      setStatusText(data.message || "Changes saved.");
    } catch (error) {
      setStatusType("error");
      setStatusText(error.message || "Failed to save changes.");
    } finally {
      setIsSavingEmployees(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setStatusType("error");
      setStatusText("Email ID and Password are required.");
      return;
    }
    setIsLoggingIn(true);
    setStatusType("loading");
    setStatusText("Authenticating...");

    try {
      await fetchJson("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          company: DEFAULT_COMPANY,
        }),
      });
      setIsAuthenticated(true);
      setStatusType("success");
      setStatusText("Login successful. Welcome!");
    } catch (error) {
      setStatusType("error");
      setStatusText(error.message || "Invalid email or password.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleGenerateReport() {
    try {
      setStatusType("loading");
      setStatusText("Generating report...");
      clearDataViews();
      const query = new URLSearchParams({
        month: String(month),
        year: String(year),
      });
      if (reportAreaFilter && reportAreaFilter !== "all") {
        query.set("area", reportAreaFilter);
      }
      const reportData = await fetchJson(`/report?${query.toString()}`);
      const areaLabel =
        reportAreaFilter && reportAreaFilter !== "all" ? ` - ${reportAreaFilter}` : "";
      setTableData({
        title: `Generated Report (${month}/${year}${areaLabel})`,
        rows: reportData?.report?.rows || [],
        groupedByDepartment: false,
        columns: reportData?.report?.columns || [],
      });
      setExcelMeta(reportData?.excel || null);
      setStatusType("success");
      setStatusText("Report generated successfully.");
    } catch (error) {
      setStatusType("error");
      setStatusText(error.message || "Failed to generate report.");
    }
  }

  async function handleFetchRaw(url, label) {
    try {
      setStatusType("loading");
      setStatusText(`Fetching ${label}...`);
      clearDataViews();
      const data = await fetchJson(url);
      setRawJson({
        title: label,
        data,
      });
      setStatusType("success");
      setStatusText(`${label} loaded successfully.`);
    } catch (error) {
      setStatusType("error");
      setStatusText(error.message || `Failed to fetch ${label}.`);
    }
  }

  async function handleAttendanceTable() {
    try {
      setStatusType("loading");
      setStatusText("Fetching attendance table...");
      clearDataViews();
      const data = await fetchJson(`/api/table/attendance?month=${month}&year=${year}`);
      setTableData({
        title: `Employee Attendance Table (${month}/${year})`,
        rows: data.rows || [],
        groupedByDepartment: true,
        columns: [],
      });
      setStatusType("success");
      setStatusText(`Attendance table loaded with ${data.total_rows || 0} rows.`);
    } catch (error) {
      setStatusType("error");
      setStatusText(error.message || "Failed to fetch attendance table.");
    }
  }

  function handleDownloadExcel() {
    const filename = excelMeta?.filename;
    if (!filename) {
      setStatusType("error");
      setStatusText("Generate or load a report with Excel output first.");
      return;
    }
    const downloadUrl = `/report/download/${encodeURIComponent(filename)}`;
    window.location.assign(downloadUrl);
  }

  function handleLogout() {
    setIsAuthenticated(false);
    setPassword("");
    setActiveTab("employee-management");
    clearDataViews();
    setEmployeeRows([]);
    setSelectedEmployeeIds([]);
    setEmployeeSearch("");
    setAreaFilter("all");
    setDepartmentFilter("all");
    setShiftFilter("all");
    setStatusType("idle");
    setStatusText("Please login to continue.");
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center p-5">
        <Card className="w-full max-w-md border-primary/20 bg-card shadow-glow">
          <CardHeader className="items-center text-center">
            <Badge variant="secondary" className="w-fit">
              Secure Access
            </Badge>
            <CardTitle className="pt-2 text-2xl">AU InfoCity - Vendor Attendance & OT Report</CardTitle>
            <CardDescription>Sign in with your vendor credentials to continue.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-4" onSubmit={handleLogin}>
              <div className="space-y-2">
                <Label htmlFor="email">Email ID</Label>
                <Input id="email" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-11"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isLoggingIn}>
                {isLoggingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                {isLoggingIn ? "Logging in..." : "Login"}
              </Button>
            </form>
          </CardContent>
        </Card>
        {statusText ? (
          <div className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex justify-center px-4">
            <div className="w-[420px] max-w-[calc(100vw-2rem)]">
              <StatusBanner text={statusText} type={statusType} />
            </div>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex h-16 w-full max-w-[1500px] items-center justify-between px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="text-lg font-semibold text-foreground">AU Infocity</div>
            <span className="text-secondary">•</span>
            <div className="truncate text-sm font-medium text-secondary">Vendor Attendance & OT Report</div>
          </div>

          <nav className="hidden items-center gap-6 md:flex">
            <button
              type="button"
              onClick={() => setActiveTab("employee-management")}
              className={`relative pb-1 text-sm font-semibold transition-colors ${
                activeTab === "employee-management" ? "text-primary" : "text-secondary hover:text-foreground"
              }`}
            >
              Employee management
              {activeTab === "employee-management" && (
                <span className="absolute -bottom-[11px] left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("reports")}
              className={`relative pb-1 text-sm font-semibold transition-colors ${
                activeTab === "reports" ? "text-primary" : "text-secondary hover:text-foreground"
              }`}
            >
              Reports
              {activeTab === "reports" && <span className="absolute -bottom-[11px] left-0 right-0 h-0.5 bg-primary" />}
            </button>
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-xs font-medium text-secondary lg:block">
              Logged in as <span className="text-foreground">{email || "User"}</span>
            </div>
            <Button variant="outline" size="sm" className="border-red-200 text-red-600 hover:bg-red-50" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] space-y-5 p-4 md:p-6">
        {activeTab === "employee-management" && (
          <section className="space-y-4">
            <Card className="bg-card/90">
              <CardContent className="pt-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-foreground">Employee management</h2>
                    <p className="max-w-3xl text-xs text-secondary">
                      Click a day cell to assign a weekly off. Security (no weekly off in rules) has no
                      day selectors.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={() => setShowImportModal(true)}>
                      <Upload className="h-4 w-4" />
                      Import
                    </Button>
                    <Button variant="outline" onClick={fetchEmployeeManagementRows} disabled={isRefreshingEmployees}>
                      {isRefreshingEmployees ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Refresh
                    </Button>
                    <Button onClick={handleSaveEmployeeChanges} disabled={isSavingEmployees}>
                      {isSavingEmployees ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save Changes
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardContent className="space-y-4 pt-6">
                <div className="grid gap-3 xl:grid-cols-4">
                  <div className="xl:col-span-1">
                    <Input
                      value={employeeSearch}
                      onChange={(event) => setEmployeeSearch(event.target.value)}
                      placeholder="Search employee, area, department..."
                      className="border border-border bg-white"
                    />
                  </div>
                  <div>
                    <select
                      className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm"
                      value={areaFilter}
                      onChange={(event) => setAreaFilter(event.target.value)}
                    >
                      <option value="all">All Areas</option>
                      {employeeFilters.areas.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <select
                      className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm"
                      value={departmentFilter}
                      onChange={(event) => setDepartmentFilter(event.target.value)}
                    >
                      <option value="all">All Departments</option>
                      {employeeFilters.departments.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <select
                      className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm"
                      value={shiftFilter}
                      onChange={(event) => setShiftFilter(event.target.value)}
                    >
                      <option value="all">All Shift Details</option>
                      {employeeFilters.shift_details.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div
                  ref={employeeGridRef}
                  tabIndex={0}
                  onKeyDown={handleEmployeeGridKeyDown}
                  className="overflow-hidden rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <table className="w-full table-fixed border-collapse">
                    <thead className="bg-muted/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="w-[3%] px-1 py-2">
                          <input
                            type="checkbox"
                            checked={
                              filteredEmployeeRows.length > 0 &&
                              filteredEmployeeRows.every((row) =>
                                selectedEmployeeIds.includes(row.employee_id)
                              )
                            }
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelectedEmployeeIds(
                                  filteredEmployeeRows.map((row) => row.employee_id)
                                );
                              } else {
                                setSelectedEmployeeIds([]);
                              }
                            }}
                          />
                        </th>
                        <th className="w-[8%] px-2 py-2">Employee ID</th>
                        <th className="w-[13%] px-2 py-2">Employee Name</th>
                        <th className="w-[10%] px-2 py-2">Area</th>
                        <th className="w-[10%] px-2 py-2">Department</th>
                        <th className="w-[12%] px-2 py-2">Shift Details</th>
                        <th className="w-[12%] px-2 py-2">Shift Time Table</th>
                        <th className="w-[7%] px-2 py-2">Week Off</th>
                        {WEEK_DAY_OPTIONS.map((day) => (
                          <th key={day.key} className="w-[4%] px-1 py-2 text-center">
                            {day.shortLabel}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployeeRows.map((row, index) => {
                        const selected = selectedEmployeeIds.includes(row.employee_id);
                        return (
                          <tr
                            key={row.employee_id}
                            className={`border-b border-border/70 ${
                              selected ? "bg-primary/10" : "hover:bg-muted/30"
                            }`}
                            onClick={(event) => handleEmployeeRowClick(event, row, index)}
                          >
                            <td className="px-1 py-2" onClick={(event) => event.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => {
                                  setSelectedEmployeeIds((prev) =>
                                    prev.includes(row.employee_id)
                                      ? prev.filter((id) => id !== row.employee_id)
                                      : [...prev, row.employee_id]
                                  );
                                }}
                              />
                            </td>
                            <td className="truncate px-2 py-2 text-[11px]" title={row.employee_id}>
                              {row.employee_id}
                            </td>
                            <td className="truncate px-2 py-2 text-[11px]" title={row.employee_name}>
                              {row.employee_name}
                            </td>
                            <td className="truncate px-2 py-2 text-[11px]" title={row.area}>
                              {row.area}
                            </td>
                            <td className="truncate px-2 py-2 text-[11px]" title={row.department}>
                              {row.department}
                            </td>
                            <td className="truncate px-2 py-2 text-[11px]" title={row.shift_details || "-"}>
                              {row.shift_details || "-"}
                            </td>
                            <td className="truncate px-2 py-2 text-[11px]" title={row.shift_timetable || "-"}>
                              {row.shift_timetable || "-"}
                            </td>
                            <td className="px-2 py-2 text-[11px] font-medium capitalize">
                              {row.week_off || "-"}
                            </td>
                            {WEEK_DAY_OPTIONS.map((day) => (
                              <td key={`${row.employee_id}-${day.key}`} className="px-1 py-2 text-center">
                                {row.has_day_selectors ? (
                                  <button
                                    type="button"
                                    className={`h-6 w-6 rounded-full border text-[9px] font-semibold ${
                                      row.week_off === day.key
                                        ? "border-primary bg-primary text-white"
                                        : "border-border bg-white text-secondary hover:border-primary/60"
                                    }`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      assignWeekOff(day.key, row);
                                    }}
                                  >
                                    {day.shortLabel[0]}
                                  </button>
                                ) : (
                                  <span className="text-xs text-secondary">-</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                      {filteredEmployeeRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={8 + WEEK_DAY_OPTIONS.length}
                            className="px-3 py-8 text-center text-sm text-secondary"
                          >
                            No employee rows found for the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="sticky bottom-3 z-20 flex flex-col gap-1 rounded-lg border border-border bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-secondary">
                <span>
                  Showing <span className="font-semibold text-foreground">{String(employeeStats.showing).padStart(2, "0")}</span>
                </span>
                <span>
                  Total Employees: <span className="font-semibold text-foreground">{String(employeeStats.total).padStart(2, "0")}</span>
                </span>
                <span>
                  Assigned Week Off: <span className="font-semibold text-foreground">{String(employeeStats.assigned).padStart(2, "0")}</span>
                </span>
                <span>
                  Unassigned Week Off: <span className="font-semibold text-foreground">{String(employeeStats.unassigned).padStart(2, "0")}</span>
                </span>
              </div>
              <a
                href="https://forefoldai.com"
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs font-medium text-primary hover:underline"
              >
                powered by forefoldai.com
              </a>
            </div>
          </section>
        )}

        {activeTab === "reports" && (
          <section className="grid gap-4 xl:grid-cols-2">
            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarRange className="h-4 w-4 text-primary" />
                  Generate Monthly Report
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="month">Month</Label>
                    <Input id="month" type="number" min="1" max="12" value={month} onChange={(e) => setMonth(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="year">Year</Label>
                    <Input id="year" type="number" min="2000" value={year} onChange={(e) => setYear(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="report-area">Area</Label>
                  <select
                    id="report-area"
                    className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm"
                    value={reportAreaFilter}
                    onChange={(event) => setReportAreaFilter(event.target.value)}
                  >
                    <option value="all">All Areas</option>
                    {employeeFilters.areas.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button onClick={handleGenerateReport}>
                    <FileSpreadsheet className="h-4 w-4" />
                    Generate
                  </Button>
                  <Button variant="secondary" onClick={handleDownloadExcel} disabled={!excelMeta?.filename}>
                    <Download className="h-4 w-4" />
                    Download Excel
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="h-4 w-4 text-primary" />
                  Report Data & Attendance Table
                </CardTitle>
                <CardDescription>Fetch report transactions and attendance table views.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Button variant="secondary" onClick={() => handleFetchRaw(`/api/data/transactions?month=${month}&year=${year}`, "Transactions")}>
                  <Clock3 className="h-4 w-4" />
                  Transactions
                </Button>
                <Button variant="secondary" onClick={() => handleFetchRaw(`/api/data/all?month=${month}&year=${year}`, "All API Data")}>
                  <Database className="h-4 w-4" />
                  All Report Data
                </Button>
                <Button variant="outline" onClick={handleAttendanceTable}>
                  <Users className="h-4 w-4" />
                  Attendance Table View
                </Button>
              </CardContent>
            </Card>
          </section>
        )}

        {activeTab === "reports" && (
          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="text-base">Results</CardTitle>
              <CardDescription>View table reports or raw API payloads from your latest action.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!rawJson && !tableData && (
                <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
                  No report loaded yet. Use any action from the cards above.
                </div>
              )}

              {tableData && (
                <DataTable
                  rows={tableData.rows}
                  title={tableData.title}
                  groupedByDepartment={tableData.groupedByDepartment}
                  columns={tableData.columns}
                />
              )}

              {rawJson && (
                <div className="space-y-3">
                  <div className="text-base font-semibold text-foreground">{rawJson.title}</div>
                  <pre className="max-h-[580px] overflow-auto rounded-lg border border-border bg-slate-50 p-4 text-xs text-slate-800">
                    {JSON.stringify(rawJson.data, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {statusText ? (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[70] flex justify-center px-4">
          <div className="w-[420px] max-w-[calc(100vw-2rem)]">
            <StatusBanner text={statusText} type={statusType} />
          </div>
        </div>
      ) : null}

      <EmployeeImportModal
        open={showImportModal}
        files={importFiles}
        importing={isImportingFiles}
        onClose={() => setShowImportModal(false)}
        onFileChange={setImportFile}
        onImport={handleImportFiles}
      />
    </main>
  );
}

export default App;
