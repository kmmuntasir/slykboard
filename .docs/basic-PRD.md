# Product Requirements Document (PRD)

| Field | Value |
| --- | --- |
| **Product Name** | Slykboard |
| **Document Status** | Draft / MVP |
| **Target Audience** | Small Engineering, Product, and Operations Teams |
| **Tech Stack** | React (Vite), Express.js (Node), PostgreSQL (PERN Stack) |

## 1. Executive Summary

Slykboard is a minimalist, open-source task management and time-tracking web application designed for small teams. Built as an alternative to bloated, enterprise-tier tools (like Jira) and paywalled reporting tools (like ClickUp), it provides a frictionless Kanban board experience. The core focus is on intuitive task management, absolute visibility into ticket history, and robust, free time-tracking and reporting capabilities out of the box.

## 2. Target Audience & Personas

- **The Team Lead / Manager (Admin):** Needs to see high-level progress, generate time reports for payroll/billing, and manage project configurations.
- **The Individual Contributor (Member):** Needs a fast, distraction-free interface to find their assigned tickets, read requirements, update statuses, and log their time with minimal clicks.

## 3. Goals & Success Metrics

- **Goal 1:** Eliminate paywalls for standard team time-tracking and reporting.
- **Goal 2:** Create a self-hostable, easy-to-deploy open-source solution.
- **Goal 3:** Keep the interface strictly functional — zero unnecessary enterprise configurations.
- **Success Metrics (MVP):** Successful deployment via Docker/Render, smooth Google SSO onboarding, and 100% accuracy in time logs regardless of browser state.

## 4. Out of Scope (For MVP)

- Mobile applications (iOS/Android).
- Custom dynamic priority levels or custom ticket fields.
- Complex RBAC (Role-Based Access Control) beyond simple Admin/Member roles.
- Real-time WebSocket syncing (standard HTTP polling at 30-second intervals will be used instead).
- Content diffing for descriptions (audit trail will only log _that_ a change occurred).

## 5. System Architecture & Tech Constraints

- **Frontend:** React.js (bundled with Vite), Zustand/Redux for state management, React Query for HTTP polling/caching, `@hello-pangea/dnd` for drag-and-drop.
- **Backend:** Node.js with Express. RESTful API design.
- **Database:** PostgreSQL.
- **Authentication:** Google SSO (OAuth 2.0).
- **Hosting:** Dockerized for easy self-hosting (VPS, Render, Supabase for DB).

## 6. Core Features & Requirements

### 6.1. Authentication & Authorization

- **REQ-1.1:** The system shall support Google SSO exclusively for the MVP.
- **REQ-1.2:** Users must belong to the permitted G-Suite workspace (if configured) or be manually whitelisted by an Admin.
- **REQ-1.3:** Two user roles: `Admin` (can manage project settings, delete tickets) and `Member` (can create, edit, and move tickets).

### 6.2. The Board & Projects

- **REQ-2.1:** The primary interface is a Kanban board.
- **REQ-2.2:** Columns must be configurable per project (e.g., "To Do", "In Progress", "In Review", "Done").
- **REQ-2.3:** Tasks must be represented as cards that are vertically sortable and horizontally draggable across columns.
- **REQ-2.4:** The board state shall refresh automatically via a 30-second background polling interval.

### 6.3. Task Management (Tickets)

- **REQ-3.1 (Ticket IDs):** Tickets must have auto-generated sequential IDs formatted as `[ProjectSlug]-[SequenceNumber]` (e.g., `PX-101`, `PX-102`).
- **REQ-3.2 (Attributes):** Each ticket must contain:
    - Title (String)
    - Description (WYSIWYG rich text editor)
    - Assignee (User dropdown)
    - Created By (system generated)
    - Labels/Tags (multi-select, color-coded)
    - Priority (hardcoded enum: `Low`, `Medium`, `High`, `Urgent`, `Critical`)
    - Checklist (array of boolean string items)
- **REQ-3.3 (Permissions):** Any authenticated user can create or edit tickets. Only `Admins` can delete tickets.

### 6.4. Time Tracking

- **REQ-4.1 (Persistent Timer):** Users must have a "Start/Stop Timer" button on each task.
- **REQ-4.2 (Backend Truth):** When "Start" is clicked, the backend logs a `start_time` timestamp. The frontend timer is purely visual. When "Stop" is clicked, the backend logs the `end_time`.
- **REQ-4.3 (Browser Independence):** A timer must continue running accurately even if the user closes their browser or turns off their computer.
- **REQ-4.4 (Manual Entry):** Users must be able to manually add time logs to a ticket (e.g., "Logged 2h 30m for research").

### 6.5. Activity History (Audit Trail)

- **REQ-5.1:** Every ticket must have a "History" or "Activity" feed.
- **REQ-5.2:** Changing an attribute (Status, Priority, Assignee, Label) must explicitly log the change (e.g., _"Muntasir changed Priority from Low to High"_).
- **REQ-5.3:** Changing the Title or Description will log a generic update (e.g., _"Muntasir updated the description"_). Content diffing is not required.

### 6.6. Reporting & Analytics

- **REQ-6.1:** A dedicated "Reports" view accessible by all users (or restricted to Admins, based on final preference).
- **REQ-6.2 (Time Log Report):** Displays total hours tracked per user, filterable by Weekly or Monthly views.
- **REQ-6.3 (Ticket Summary):** Displays the total number of tickets resolved/worked on by each member in the timeframe, broken down by Priority.

## 7. User Journeys & Stories

### User Journey 1: The Daily Standup & Workflow

1. Muntasir logs in via Google SSO.
2. He lands on the "PX Project" board.
3. He sees a ticket (`PX-104`) assigned to him in the "To Do" column.
4. He drags `PX-104` to "In Progress".
5. He clicks on the card to open the modal and clicks "Start Timer".
6. He closes the tab and writes code for 2 hours.
7. He reopens the app, opens `PX-104`, clicks "Stop Timer", and ticks off two items on the Checklist.
8. He drags the card to "In Review".

**Related User Stories:**

- _As a Member, I want to log in with my Google account so I don't have to remember another password._
- _As a Member, I want to drag and drop cards so I can quickly update my task status._
- _As a Member, I want the timer to run on the server so I don't lose my tracked time if my browser crashes._

### User Journey 2: The Weekly Manager Review

1. The PX Team Lead logs in on Friday afternoon.
2. They navigate to the "Reports" tab.
3. They set the filter to "This Week".
4. They see a table showing Muntasir logged 38 hours, resolving 4 High priority tickets and 6 Medium priority tickets.
5. They export or review the data for their sprint retrospective.

**Related User Stories:**

- _As a Team Lead, I want to see a summary of time logged per team member so I can monitor workload capacity._
- _As a Team Lead, I want to see how many high-priority tickets were resolved so I can measure team impact._

### User Journey 3: The Audit Trail Check

1. A team member notices `PX-110` is suddenly marked as "Critical".
2. They open the ticket and scroll down to the Activity section.
3. They see a system log: "Admin changed Priority from Medium to Critical at 10:15 AM."
4. They now have the context to start working on it immediately.

**Related User Stories:**

- _As a Member, I want to see the history of a ticket so I know who changed its requirements and when._

## 8. Database Schema (MVP Draft)

The database will be structured using PostgreSQL. Below are the core tables.

### 1. Users

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `google_id` | String | Unique |
| `email` | String | Unique |
| `full_name` | String | |
| `avatar_url` | String | |
| `role` | Enum | `'ADMIN'`, `'MEMBER'` |

### 2. Projects

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `name` | String | |
| `slug` | String | Unique (e.g., `'PX'`) |
| `columns` | JSONB | e.g., `['To Do', 'In Progress', 'Done']` |

### 3. Tickets

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `project_id` | UUID | FK → Projects |
| `ticket_number` | Integer | Auto-increment per project |
| `title` | String | |
| `description` | Text | |
| `status_column` | String | |
| `priority` | Enum | `'LOW'`, `'MEDIUM'`, `'HIGH'`, `'URGENT'`, `'CRITICAL'` |
| `assignee_id` | UUID | FK → Users, nullable |
| `creator_id` | UUID | FK → Users |
| `labels` | String[] | Array of strings |
| `checklist` | JSONB | |
| `created_at` | Timestamp | |
| `updated_at` | Timestamp | |

### 4. TimeEntries

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `ticket_id` | UUID | FK → Tickets |
| `user_id` | UUID | FK → Users |
| `start_time` | Timestamp | |
| `end_time` | Timestamp | Nullable |
| `manual_entry_minutes` | Integer | Nullable |
| `description` | String | Nullable |

### 5. ActivityLogs

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `ticket_id` | UUID | FK → Tickets |
| `user_id` | UUID | FK → Users |
| `action_type` | Enum | `'CREATED'`, `'STATUS_CHANGED'`, `'PRIORITY_CHANGED'`, `'ASSIGNEE_CHANGED'`, `'CONTENT_UPDATED'` |
| `old_value` | String | Nullable |
| `new_value` | String | Nullable |
| `created_at` | Timestamp | |

## 9. Future Considerations (Post-MVP)

- Webhook integrations (Slack/Discord notifications on ticket updates).
- GitHub/GitLab integration (auto-move tickets when a PR is merged mentioning the ticket ID).
- Custom workflow automation (e.g., if checklist is complete, move to "Review").
- Exporting reports to CSV/PDF.
