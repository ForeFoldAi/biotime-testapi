# ForeFold Report Generator

Node.js + Express backend for attendance and overtime calculation using BioTime APIs, Excel masters, and JSON-based storage.

## Features

- BioTime authentication attempts in order:
  - `POST /api-token-auth/`
  - `POST /jwt-api-token-auth/`
- Employee and transaction fetching with pagination support (`next`)
- Attendance processing:
  - First punch = check-in
  - Last punch = check-out
  - Working hours = checkout - checkin
- Shift detection with overnight shift support
- Department-wise rule engine:
  - MEP / O&M
  - Security
  - Housekeeping
  - Landscape / Pest Control
- Weekly off logic (`W/O` or `L`)
- Excel upload APIs for shift/weekoff/schedule masters
- Monthly JSON report + Excel export (`outputs/`)
- Basic web UI (`/`) to upload and generate/view reports

## Project Structure

```text
src/
  config/
  services/
  parsers/
  models/
  processors/
  engines/
  rules/
  controllers/
  reports/
  storage/
  utils/
  public/
uploads/
outputs/
```

## Setup

1. Install dependencies:
   - `npm install`
2. Create env file:
   - `cp .env.example .env`
3. Update `.env` with real BioTime credentials.
   - include `BIO_TIME_COMPANY=auinfocity`
4. Start server:
   - `npm run dev`

Server URL: `http://localhost:4000`

## APIs

- `POST /upload/shifts` (multipart form-data, field: `file`)
- `POST /upload/weekoffs` (multipart form-data, field: `file`)
- `POST /upload/schedules` (multipart form-data, field: `file`)
- `POST /upload/timetables` (multipart form-data, field: `file`)
- `GET /report?month=MM&year=YYYY`
- `GET /report/last`
- `GET /attendance/checkins?month=MM&year=YYYY`
- `GET /api/data/employees` (all employee details from API)
- `GET /api/data/departments` (department API + derived department list from employees)
- `GET /api/data/transactions?month=MM&year=YYYY` (all transaction rows from API)
- `GET /api/data/all?month=MM&year=YYYY` (employees + departments + transactions together)
- `GET /api/list/:resource` (generic list endpoint proxy with pagination/filter/search/order)
- `GET /health`

## Deployment Note

- Uploaded Excel files are processed in-memory (no dependency on local uploaded file paths).
- Runtime masters (`shifts`, `weekoffs`, `schedules`, timetable exports, employee schedule exports) are read from in-memory store during API processing.

### Generic List Endpoint

Use:
- `GET /api/list/areas`
- `GET /api/list/departments`
- `GET /api/list/employees`
- `GET /api/list/locations`
- `GET /api/list/positions`
- `GET /api/list/transactions`

Supports query params passthrough:
- `page`, `page_size`
- `search`, `ordering`
- endpoint-specific filters (for example `dept_name_icontains`, `emp_code`, `start_time`, `end_time`, etc.)
- `all_pages=true` to fetch every page automatically
- For `employees`, `all_pages` is enabled by default to return all employees
- Use `max_pages` to cap pagination safety limit (default `50` for employees)

Examples:
- `/api/list/employees?page=1&page_size=50&search=Ravi&ordering=emp_code`
- `/api/list/departments?dept_name_icontains=MEP&all_pages=true`
- `/api/list/transactions?start_time=2026-04-01%2000:00:00&end_time=2026-04-30%2023:59:59&page_size=100`

## Excel Input Notes

- Shift master columns (example):
  - `department`, `code`, `start`, `end`
- Week off columns (example):
  - `employee_id`, `week_off`
- Schedule columns (example):
  - `employee_id`, `date` (`YYYY-MM-DD`), `shift`

## Output

- JSON report returned in `GET /report`
- Employee details with per-day check-in/check-out in `GET /attendance/checkins`
- Excel report generated in `outputs/attendance-report-YYYY-MM.xlsx`
