# SurplusLink — Rescue Food. Deliver Impact.

## 1. Project Overview

SurplusLink is a web application that helps restaurants share surplus food with volunteers who can collect it before it goes to waste.

Restaurants can post food donations with quantities and pickup windows. Volunteers can view donations available in their permitted zones, reserve quantities, and record collections. The application validates booking rules and provides an impact dashboard to track the movement of donated food.

## 2. Key Features

- **Role selection:** Switch between restaurant donors and volunteers without a login.
- **Donation management:** Post surplus food and cancel eligible donations.
- **Volunteer reservations:** View available donations in permitted zones and reserve a quantity with a planned pickup time.
- **Claim validation:** Check donation availability, volunteer capacity, remaining quantity, permitted zone, pickup window, simulated time, and 60-minute pickup spacing.
- **Pickup management:** Collect or cancel eligible claims.
- **Simulated clock:** Advance application time to test pickup windows and expired donations.
- **Impact dashboard:** Show listed, collected, missed, wasted, in-progress, and still-open quantities.
- **Rescue integrity:** Compare the listed quantity against the sum of all five accounting categories.
- **Impact reports:** Display collected quantities by restaurant and volunteer performance.
- **Action history:** Record important actions and their outcomes.
- **Persistent storage:** Store application state in a local JSON file so it can survive a backend restart.

## 3. Technology Stack

- Frontend: React
- Development server and build tool: Vite
- Backend: Node.js and Express
- Middleware: CORS
- Storage: Local JSON file
- Version control: Git and GitHub

## 4. Project Structure

```text
surpluslink/
├── public/
├── src/
│   ├── App.jsx
│   ├── App.css
│   ├── index.css
│   └── main.jsx
├── server/
│   ├── data/
│   │   └── state.json
│   └── seed.json
├── server.js
├── package.json
├── package-lock.json
├── README.md
├── AI_USAGE.md
└── .gitignore
```

The backend creates `server/data/state.json` when it initializes the application. This file contains runtime data and is excluded from version control; the supplied `server/seed.json` provides the initial dataset.

## 5. Prerequisites

Install Node.js and npm, then open the project folder in Visual Studio Code.

## 6. Installation

From the project root, install the dependencies:

```powershell
npm.cmd install
```

If the backend dependencies are not already installed, run:

```powershell
npm.cmd install express cors
```

## 7. Running the Application

Start the backend in the first terminal:

```powershell
npm.cmd run server
```

The backend runs at:

`http://localhost:5000`

Start the frontend in a second terminal:

```powershell
npm.cmd run dev
```

Open the local URL printed by Vite, usually:

`http://localhost:5173`

If that port is occupied, use the alternative URL printed in the terminal.

## 8. API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/state` | Retrieve application state |
| GET | `/api/dashboard` | Retrieve impact and accounting statistics |
| POST | `/api/clock` | Advance simulated time |
| POST | `/api/donations` | Create a donation |
| POST | `/api/donations/:id/cancel` | Cancel an eligible donation |
| POST | `/api/claims` | Validate and create a claim |
| POST | `/api/claims/:id/collect` | Mark an eligible claim as collected |
| POST | `/api/claims/:id/cancel` | Cancel an eligible active claim |

## 9. Accounting Logic

The dashboard checks that:

**Listed = Collected + Missed + Wasted + In progress + Still open**

Cancelled donations are excluded from the dashboard totals. Cancelled claims do not consume donation quantities. The application uses the simulated clock rather than the real computer clock for scheduling and expiry rules.

## 10. Building for Production

To check the frontend production build, run:

```powershell
npm.cmd run build
```

Vite generates the production files in the `dist/` directory.

## 11. Testing Notes

The application was run locally in a browser. Manual checks included the initial dashboard, donation and claim workflows, claim cancellation, collection, action history, accounting totals, and backend persistence across a restart.

The production build completed successfully during development. These checks do not constitute exhaustive automated testing of every rule and edge case.

## 12. Assumptions and Limitations

- Role selection is used instead of login or authentication.
- All times are represented in the supplied timezone-free `YYYY-MM-DDTHH:MM` format.
- The simulated clock is the source of truth for application-time rules.
- Data is stored in a local JSON file rather than an external database.
- The application is intended to run locally without paid services or API credentials.
- The local JSON storage approach is intended for this single-process hackathon application, not a multi-server production deployment.