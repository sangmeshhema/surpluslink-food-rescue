# AI Usage Disclosure — SurplusLink

## 1. AI Tool Used

**Tool:** ChatGPT by OpenAI

ChatGPT was used as a development assistant during the SurplusLink hackathon project.

## 2. Areas Where AI Assisted

AI assistance was used for:

- Planning the application structure and prioritizing features within the hackathon time limit.
- Drafting React components and styling for the donor and volunteer interfaces.
- Connecting the React frontend to the Express backend.
- Drafting backend logic for donations, claims, collection, cancellation, and simulated-time handling.
- Reviewing claim validation rules and dashboard accounting calculations.
- Debugging setup problems involving npm, PowerShell, package configuration, and local development servers.
- Separating quantity and planned pickup inputs so each donation card maintains its own form state.
- Drafting the project README and this AI usage disclosure.

## 3. Code Accepted and Adapted

The project uses React with Vite for the frontend and Node.js with Express for the backend. AI-suggested code was incorporated and adapted to the existing project structure.

The implementation was adjusted to:

- Use ES modules to match the project's `"type": "module"` configuration.
- Use `npm.cmd` commands in Windows PowerShell where required.
- Persist runtime application state in a local JSON file.
- Use the supplied seed data and simulated clock.
- Maintain independent reservation form values for each donation card.
- Display validation outcomes, dashboard figures, impact statistics, and action history.

## 4. Validation and Testing

AI assistance was used to review the claim rules, including volunteer capacity, remaining donation quantity, permitted zones, pickup windows, simulated time, and the 60-minute spacing requirement.

The application was run locally and manually exercised in the browser. The production build completed successfully, and backend persistence was checked by restarting the backend and verifying the saved state.

These checks were manual. They do not establish that every possible business-rule edge case has been tested. Existing test data may include claims created before subsequent validation fixes.

## 5. Changes and Engineering Decisions

The generated suggestions were adapted to the actual project rather than copied without review. The developer ran commands, inspected results, tested application workflows, and adjusted code in response to observed issues.

The application uses local JSON storage and does not rely on paid APIs or external service credentials. No real-time maps or third-party AI APIs were added.

## 6. Limitations

AI-generated code can contain mistakes. The code and recommendations were reviewed iteratively, but further testing may still identify defects. The application should not be considered production-ready solely because the development server and production build run successfully.

## 7. Declaration

AI was used as a development and debugging aid. The project was assembled and tested locally, and this document describes the areas where AI assistance was used and the verification performed during development.