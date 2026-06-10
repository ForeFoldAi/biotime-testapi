import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Loader2,
  LogIn,
  RefreshCw,
  Search,
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

function formatCellValue(column, value) {
  if (value === null || value === undefined) return "";
  if (column !== "check_in" && column !== "check_out") return String(value);

  const text = String(value).trim();
  const match = text.match(/(\d{2}:\d{2}(:\d{2})?)/);
  return match ? match[1] : text;
}

function valueMatchesSearch(value, term) {
  if (value === null || value === undefined) return false;
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.some((item) => valueMatchesSearch(item, term));
    }
    return Object.values(value).some((item) => valueMatchesSearch(item, term));
  }
  return String(value).toLowerCase().includes(term);
}

function filterTableRows(rows, searchTerm) {
  const term = searchTerm.trim().toLowerCase();
  if (!term || !Array.isArray(rows)) return rows || [];
  return rows.filter((row) => valueMatchesSearch(row, term));
}

const EMPTY_RAW_TRANSACTION_FILTERS = {
  punch_time: [],
  terminal_alias: [],
  area_alias: [],
};

function getTransactionsFromRawData(data, kind) {
  if (kind === "transactions") return data?.rows || [];
  if (kind === "all-api-data") return data?.transactions || [];
  return [];
}

function getPunchTimeFilterValue(punchTime) {
  const text = String(punchTime || "").trim();
  if (!text) return "(empty)";
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function buildRawTransactionFilterOptions(transactions) {
  const punchTimes = new Set();
  const terminals = new Set();
  const areas = new Set();

  for (const row of transactions) {
    punchTimes.add(getPunchTimeFilterValue(row?.punch_time));
    terminals.add(String(row?.terminal_alias || "").trim() || "(empty)");
    areas.add(String(row?.area_alias || "").trim() || "(empty)");
  }

  return {
    punch_time: [...punchTimes].sort(),
    terminal_alias: [...terminals].sort((a, b) => a.localeCompare(b)),
    area_alias: [...areas].sort((a, b) => a.localeCompare(b)),
  };
}

function hasActiveTransactionFilters(filters = EMPTY_RAW_TRANSACTION_FILTERS) {
  return (
    (filters.punch_time?.length || 0) > 0 ||
    (filters.terminal_alias?.length || 0) > 0 ||
    (filters.area_alias?.length || 0) > 0
  );
}

function matchesTransactionFilters(row, filters) {
  const punchTimes = filters?.punch_time || [];
  const terminals = filters?.terminal_alias || [];
  const areas = filters?.area_alias || [];

  if (punchTimes.length > 0) {
    const value = getPunchTimeFilterValue(row?.punch_time);
    if (!punchTimes.includes(value)) return false;
  }
  if (terminals.length > 0) {
    const value = String(row?.terminal_alias || "").trim() || "(empty)";
    if (!terminals.includes(value)) return false;
  }
  if (areas.length > 0) {
    const value = String(row?.area_alias || "").trim() || "(empty)";
    if (!areas.includes(value)) return false;
  }
  return true;
}

function filterTransactionsByDropdown(transactions, filters) {
  if (!hasActiveTransactionFilters(filters)) return transactions;
  return transactions.filter((row) => matchesTransactionFilters(row, filters));
}

function buildFilteredTransactionResponse(originalData, filteredRows) {
  return {
    month: originalData?.month,
    year: originalData?.year,
    start_time: originalData?.start_time,
    end_time: originalData?.end_time,
    total: filteredRows.length,
    rows: filteredRows,
  };
}

function countRawJsonItems(data, kind) {
  if (kind === "transactions") {
    const total = data?.rows?.length || 0;
    return { showing: total, total };
  }
  if (kind === "all-api-data") {
    const total =
      (data?.employees?.length || 0) +
      (data?.transactions?.length || 0) +
      (data?.departments?.length || 0) +
      (data?.derived_departments?.length || 0);
    return { showing: total, total };
  }
  return { showing: 0, total: 0 };
}

function filterRawJsonData(data, kind, searchTerm, transactionFilters = EMPTY_RAW_TRANSACTION_FILTERS) {
  const term = searchTerm.trim().toLowerCase();
  const sourceTransactions = getTransactionsFromRawData(data, kind);
  const dropdownFiltered = filterTransactionsByDropdown(sourceTransactions, transactionFilters);
  const transactionsAfterSearch = term
    ? filterTableRows(dropdownFiltered, searchTerm)
    : dropdownFiltered;

  if (hasActiveTransactionFilters(transactionFilters)) {
    return {
      data: buildFilteredTransactionResponse(data, transactionsAfterSearch),
      showing: transactionsAfterSearch.length,
      total: sourceTransactions.length,
    };
  }

  if (kind === "transactions") {
    const sourceRows = data?.rows || [];
    const rows = term ? filterTableRows(sourceRows, searchTerm) : sourceRows;
    return {
      data: { ...data, rows, total: rows.length },
      showing: rows.length,
      total: sourceRows.length,
    };
  }

  if (kind === "all-api-data") {
    const employees = term ? filterTableRows(data?.employees || [], searchTerm) : data?.employees || [];
    const transactions = term ? filterTableRows(data?.transactions || [], searchTerm) : data?.transactions || [];
    const departments = term ? filterTableRows(data?.departments || [], searchTerm) : data?.departments || [];
    const derivedDepartments = term
      ? filterTableRows(data?.derived_departments || [], searchTerm)
      : data?.derived_departments || [];
    return {
      data: {
        ...data,
        employees,
        transactions,
        departments,
        derived_departments: derivedDepartments,
      },
      showing: employees.length + transactions.length + departments.length + derivedDepartments.length,
      total:
        (data?.employees?.length || 0) +
        (data?.transactions?.length || 0) +
        (data?.departments?.length || 0) +
        (data?.derived_departments?.length || 0),
    };
  }

  if (!term) return { data, ...countRawJsonItems(data, kind) };
  return { data, showing: 0, total: 0 };
}

function RawTransactionCheckboxDropdown({ label, selected, options, onToggle, onClear, onSelectAll }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selectedCount = selected.length;
  const triggerLabel =
    selectedCount === 0
      ? "All"
      : selectedCount === 1
      ? selected[0]
      : `${selectedCount} selected`;

  return (
    <div ref={containerRef} className="relative space-y-2">
      <Label>{label}</Label>
      <button
        type="button"
        className="flex h-10 w-full items-center justify-between rounded-lg border border-border bg-white px-3 text-left text-sm"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate text-foreground">{triggerLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-secondary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-white p-2 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-border/70 pb-2 text-[10px]">
            <button type="button" className="text-primary hover:underline" onClick={() => onSelectAll(options)}>
              Select all
            </button>
            <button type="button" className="text-secondary hover:underline" onClick={onClear}>
              Clear
            </button>
          </div>
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {options.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border"
                  checked={selected.includes(option)}
                  onChange={() => onToggle(option)}
                />
                <span className="truncate" title={option}>
                  {option}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function exportRowsToCsv(rows, columns, filename) {
  if (!Array.isArray(rows) || rows.length === 0) return false;

  const cols =
    Array.isArray(columns) && columns.length > 0 ? columns : Object.keys(rows[0]);
  const escapeCsv = (value) => {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  const lines = [
    cols.join(","),
    ...rows.map((row) =>
      cols.map((column) => escapeCsv(formatCellValue(column, row[column]))).join(",")
    ),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
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
  const [username, setUsername] = useState("");
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
  const [tableSearch, setTableSearch] = useState("");
  const [rawTransactionFilters, setRawTransactionFilters] = useState(EMPTY_RAW_TRANSACTION_FILTERS);
  const [allApiDataNotes, setAllApiDataNotes] = useState("");
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
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const [isRefreshingEmployees, setIsRefreshingEmployees] = useState(false);
  const [importFiles, setImportFiles] = useState({
    shifts: null,
    timetables: null,
    schedules: null,
  });

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
    setTableSearch("");
    setRawTransactionFilters(EMPTY_RAW_TRANSACTION_FILTERS);
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

  const filteredTableRows = useMemo(() => {
    if (!tableData?.rows) return [];
    return filterTableRows(tableData.rows, tableSearch);
  }, [tableData, tableSearch]);

  const rawTransactionFilterOptions = useMemo(() => {
    if (!rawJson?.data) return null;
    const transactions = getTransactionsFromRawData(rawJson.data, rawJson.kind);
    if (transactions.length === 0) return null;
    return buildRawTransactionFilterOptions(transactions);
  }, [rawJson]);

  const filteredRawJson = useMemo(() => {
    if (!rawJson?.data) return null;
    const filtered = filterRawJsonData(
      rawJson.data,
      rawJson.kind,
      tableSearch,
      rawTransactionFilters
    );
    return {
      title: rawJson.title,
      kind: rawJson.kind,
      data: filtered.data,
      showing: filtered.showing,
      total: filtered.total,
    };
  }, [rawJson, tableSearch, rawTransactionFilters]);

  function toggleRawTransactionFilter(groupKey, value) {
    setRawTransactionFilters((prev) => {
      const current = prev[groupKey] || [];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      return { ...prev, [groupKey]: next };
    });
  }

  function clearRawTransactionFilterGroup(groupKey) {
    setRawTransactionFilters((prev) => ({ ...prev, [groupKey]: [] }));
  }

  function selectAllRawTransactionFilterGroup(groupKey, options) {
    setRawTransactionFilters((prev) => ({ ...prev, [groupKey]: [...options] }));
  }

  function clearAllRawTransactionFilters() {
    setRawTransactionFilters(EMPTY_RAW_TRANSACTION_FILTERS);
  }

  const resultRowStats = useMemo(() => {
    if (tableData) {
      return {
        showing: filteredTableRows.length,
        total: tableData.rows?.length || 0,
      };
    }
    if (filteredRawJson) {
      return {
        showing: filteredRawJson.showing,
        total: filteredRawJson.total,
      };
    }
    return { showing: 0, total: 0 };
  }, [tableData, filteredTableRows, filteredRawJson]);

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

  async function handleLogin(event) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setStatusType("error");
      setStatusText("User name and Password are required.");
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
          username: username.trim(),
          password,
        }),
      });
      setIsAuthenticated(true);
      setStatusType("success");
      setStatusText("Login successful. Welcome!");
    } catch (error) {
      setStatusType("error");
      setStatusText(error.message || "Invalid user name or password.");
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
        kind: "report",
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

  async function handleFetchRaw(url, label, kind) {
    try {
      setStatusType("loading");
      setStatusText(`Fetching ${label}...`);
      clearDataViews();
      const data = await fetchJson(url);
      setRawJson({
        title: label,
        kind,
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
        kind: "attendance",
        title: `Employee Attendance Table (${month}/${year})`,
        rows: data.rows || [],
        groupedByDepartment: true,
        columns: [
          "date",
          "employee_code",
          "employee_name",
          "department",
          "position",
          "area",
          "check_in",
          "check_out",
          "check_in_terminal",
          "check_out_terminal",
          "working_hours",
          "punch_count",
          "employee_shift_name",
          "scheduled_shift",
          "normal_shift",
          "ot_shift",
          "attendance_status",
          "ot_hours",
          "is_ot",
        ],
      });
      setStatusType("success");
      setStatusText(`Attendance table loaded with ${data.total_rows || 0} rows.`);
    } catch (error) {
      setStatusType("error");
      setStatusText(error.message || "Failed to fetch attendance table.");
    }
  }

  function handleExportAttendanceTable() {
    if (!tableData || tableData.kind !== "attendance") {
      setStatusType("error");
      setStatusText("Load the Attendance Table View before exporting.");
      return;
    }
    if (filteredTableRows.length === 0) {
      setStatusType("error");
      setStatusText("No rows match the current search to export.");
      return;
    }

    const columns =
      Array.isArray(tableData.columns) && tableData.columns.length > 0
        ? tableData.columns
        : Object.keys(filteredTableRows[0] || {});
    const filename = `attendance-table-${month}-${year}.csv`;
    const exported = exportRowsToCsv(filteredTableRows, columns, filename);
    if (exported) {
      setStatusType("success");
      setStatusText(`Exported ${filteredTableRows.length} rows to ${filename}.`);
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
    setEmployeeSearch("");
    setAreaFilter("all");
    setDepartmentFilter("all");
    setShiftFilter("all");
    setAllApiDataNotes("");
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
                <Label htmlFor="username">User name</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your user name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
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
              Logged in as <span className="text-foreground">{username || "User"}</span>
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
                      Weekly off days are loaded from BioTime employee records. Import shift and schedule
                      files to populate shift details.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={() => setShowImportModal(true)}>
                      <Download className="h-4 w-4" />
                      Import
                    </Button>
                    <Button variant="outline" onClick={fetchEmployeeManagementRows} disabled={isRefreshingEmployees}>
                      {isRefreshingEmployees ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Refresh
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

                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full table-fixed border-collapse">
                    <thead className="bg-muted/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="w-[9%] px-2 py-2">Employee ID</th>
                        <th className="w-[15%] px-2 py-2">Employee Name</th>
                        <th className="w-[12%] px-2 py-2">Area</th>
                        <th className="w-[12%] px-2 py-2">Department</th>
                        <th className="w-[14%] px-2 py-2">Shift Details</th>
                        <th className="w-[14%] px-2 py-2">Shift Time Table</th>
                        <th className="w-[10%] px-2 py-2">Week Off</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployeeRows.map((row) => (
                        <tr key={row.employee_id} className="border-b border-border/70 hover:bg-muted/30">
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
                        </tr>
                      ))}
                      {filteredEmployeeRows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-sm text-secondary">
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
                <Button
                  variant="secondary"
                  onClick={() =>
                    handleFetchRaw(
                      `/api/data/transactions?month=${month}&year=${year}`,
                      "Transactions",
                      "transactions"
                    )
                  }
                >
                  <Clock3 className="h-4 w-4" />
                  Transactions
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    handleFetchRaw(`/api/data/all?month=${month}&year=${year}`, "All API Data", "all-api-data")
                  }
                >
                  <Database className="h-4 w-4" />
                  All API Data
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

              {(tableData || rawJson) && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative w-full sm:max-w-md">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
                      <Input
                        value={tableSearch}
                        onChange={(event) => setTableSearch(event.target.value)}
                        placeholder="Search employee, department, date, terminal, shift..."
                        className="border border-border bg-white pl-9"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-secondary">
                        Showing{" "}
                        <span className="font-semibold text-foreground">{resultRowStats.showing}</span> of{" "}
                        <span className="font-semibold text-foreground">{resultRowStats.total}</span> rows
                      </span>
                      {tableData?.kind === "attendance" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleExportAttendanceTable}
                          disabled={filteredTableRows.length === 0}
                        >
                          <Download className="h-4 w-4" />
                          Export CSV
                        </Button>
                      )}
                    </div>
                  </div>

                  {tableData && (
                    <DataTable
                      rows={filteredTableRows}
                      title={tableData.title}
                      groupedByDepartment={tableData.groupedByDepartment}
                      columns={tableData.columns}
                    />
                  )}

                  {rawJson && rawTransactionFilterOptions && (
                    <div className="space-y-3 rounded-lg border border-border bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">Transaction Filters</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearAllRawTransactionFilters}
                          disabled={!hasActiveTransactionFilters(rawTransactionFilters)}
                        >
                          Reset filters
                        </Button>
                      </div>
                      <div className="grid gap-3 lg:grid-cols-3">
                        <RawTransactionCheckboxDropdown
                          label="punch_time"
                          selected={rawTransactionFilters.punch_time}
                          options={rawTransactionFilterOptions.punch_time}
                          onToggle={(value) => toggleRawTransactionFilter("punch_time", value)}
                          onClear={() => clearRawTransactionFilterGroup("punch_time")}
                          onSelectAll={(options) => selectAllRawTransactionFilterGroup("punch_time", options)}
                        />
                        <RawTransactionCheckboxDropdown
                          label="terminal_alias"
                          selected={rawTransactionFilters.terminal_alias}
                          options={rawTransactionFilterOptions.terminal_alias}
                          onToggle={(value) => toggleRawTransactionFilter("terminal_alias", value)}
                          onClear={() => clearRawTransactionFilterGroup("terminal_alias")}
                          onSelectAll={(options) => selectAllRawTransactionFilterGroup("terminal_alias", options)}
                        />
                        <RawTransactionCheckboxDropdown
                          label="area_alias"
                          selected={rawTransactionFilters.area_alias}
                          options={rawTransactionFilterOptions.area_alias}
                          onToggle={(value) => toggleRawTransactionFilter("area_alias", value)}
                          onClear={() => clearRawTransactionFilterGroup("area_alias")}
                          onSelectAll={(options) => selectAllRawTransactionFilterGroup("area_alias", options)}
                        />
                      </div>
                      {hasActiveTransactionFilters(rawTransactionFilters) && (
                        <p className="text-xs text-secondary">
                          Showing only matching transaction API rows for the selected filters.
                        </p>
                      )}
                    </div>
                  )}

                  {filteredRawJson && filteredRawJson.kind === "all-api-data" && (
                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="space-y-3">
                        <div className="text-base font-semibold text-foreground">All API Data</div>
                        <pre className="max-h-[580px] overflow-auto rounded-lg border border-border bg-slate-50 p-4 text-xs text-slate-800">
                          {JSON.stringify(filteredRawJson.data, null, 2)}
                        </pre>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="all-api-data-notes">Notes</Label>
                        <textarea
                          id="all-api-data-notes"
                          value={allApiDataNotes}
                          onChange={(event) => setAllApiDataNotes(event.target.value)}
                          placeholder="Add your notes here..."
                          className="min-h-[580px] w-full resize-y rounded-lg border border-border bg-white p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                    </div>
                  )}

                  {filteredRawJson && filteredRawJson.kind !== "all-api-data" && (
                    <div className="space-y-3">
                      <div className="text-base font-semibold text-foreground">{filteredRawJson.title}</div>
                      <pre className="max-h-[580px] overflow-auto rounded-lg border border-border bg-slate-50 p-4 text-xs text-slate-800">
                        {JSON.stringify(filteredRawJson.data, null, 2)}
                      </pre>
                    </div>
                  )}
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
