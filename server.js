
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const root = path.dirname(fileURLToPath(import.meta.url));

const dataDir = path.join(root, "server", "data");
const seedFile = path.join(root, "server", "seed.json");
const stateFile = path.join(dataDir, "state.json");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

fs.mkdirSync(dataDir, { recursive: true });

// Parse the PS's timezone-free YYYY-MM-DDTHH:MM format.
// Do not use the real system clock for application rules.
function parseLocalMinutes(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
  ) {
    return null;
  }

  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const timestamp = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute
  );

  const check = new Date(timestamp);

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return timestamp / 60000;
}

function formatError(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

function readSeed() {
  if (!fs.existsSync(seedFile)) {
    throw new Error(`Seed file not found: ${seedFile}`);
  }

  const seed = JSON.parse(
    fs.readFileSync(seedFile, "utf8")
  );

  if (
    !seed ||
    !Array.isArray(seed.donors) ||
    !Array.isArray(seed.volunteers) ||
    !Array.isArray(seed.donations) ||
    typeof seed.clock !== "string"
  ) {
    throw new Error(
      "seed.json does not have the expected SurplusLink structure."
    );
  }

  if (parseLocalMinutes(seed.clock) === null) {
    throw new Error(
      "seed.json contains an invalid simulated clock value."
    );
  }

  return {
    ...seed,
    claims: [],
    cancelledDonations: [],
    history: [],
  };
}

function loadState() {
  if (
    fs.existsSync(stateFile) &&
    fs.statSync(stateFile).size > 0
  ) {
    // Preserve existing user data; never silently reset it.
    const saved = JSON.parse(
      fs.readFileSync(stateFile, "utf8")
    );

    if (
      !saved ||
      !Array.isArray(saved.donors) ||
      !Array.isArray(saved.volunteers) ||
      !Array.isArray(saved.donations) ||
      typeof saved.clock !== "string"
    ) {
      throw new Error(
        "state.json is malformed. Back it up and repair it; it was not overwritten."
      );
    }

    return saved;
  }

  return readSeed();
}

let state = loadState();

state.claims = Array.isArray(state.claims)
  ? state.claims
  : [];

state.cancelledDonations = Array.isArray(
  state.cancelledDonations
)
  ? state.cancelledDonations
  : [];

state.history = Array.isArray(state.history)
  ? state.history
  : [];

if (parseLocalMinutes(state.clock) === null) {
  throw new Error(
    "state.json has an invalid simulated clock value. Back it up and repair it before starting the server."
  );
}

function saveState() {
  fs.mkdirSync(dataDir, { recursive: true });

  const temporaryFile = `${stateFile}.${process.pid}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(state, null, 2),
    "utf8"
  );

  fs.renameSync(temporaryFile, stateFile);
}

// Save normalized state while preserving existing records.
saveState();

const getDonor = (id) =>
  state.donors.find((item) => item.id === id);

const getVolunteer = (id) =>
  state.volunteers.find((item) => item.id === id);

const getDonation = (id) =>
  state.donations.find((item) => item.id === id);

const createId = (prefix) =>
  `${prefix}-${randomUUID()}`;

function remainingKg(donation) {
  return (
    donation.quantity_kg -
    state.claims
      .filter(
        (claim) =>
          claim.donation_id === donation.id &&
          claim.status !== "CANCELLED"
      )
      .reduce(
        (total, claim) => total + claim.kg,
        0
      )
  );
}

// Status precedence follows the problem statement.
function donationStatus(donation) {
  if (state.cancelledDonations.includes(donation.id)) {
    return "CANCELLED";
  }

  const now = parseLocalMinutes(state.clock);
  const until = parseLocalMinutes(donation.pickup_until);

  if (now === null || until === null) {
    return "INVALID";
  }

  if (now > until) {
    return "EXPIRED";
  }

  if (remainingKg(donation) <= 0) {
    return "FULLY_CLAIMED";
  }

  return "OPEN";
}

function addHistory(
  actor,
  action,
  donationId,
  outcome,
  detail = ""
) {
  state.history.unshift({
    id: createId("H"),
    time: state.clock,
    actor: actor || "UNKNOWN",
    action,
    donation_id: donationId || null,
    outcome,
    detail,
  });
}

// When the simulated clock passes the pickup deadline,
// every ACTIVE claim on that donation becomes MISSED.
function updateMissedClaims() {
  let changed = false;
  const now = parseLocalMinutes(state.clock);

  for (const donation of state.donations) {
    const until = parseLocalMinutes(donation.pickup_until);

    if (until === null || now === null || now <= until) {
      continue;
    }

    for (const claim of state.claims) {
      if (
        claim.donation_id === donation.id &&
        claim.status === "ACTIVE"
      ) {
        claim.status = "MISSED";

        addHistory(
          "SYSTEM",
          "MISSED",
          donation.id,
          "SUCCESS",
          `${claim.kg} kg`
        );

        changed = true;
      }
    }
  }

  if (changed) {
    saveState();
  }

  return changed;
}

function validateClaim(
  volunteer,
  donation,
  kg,
  plannedTime
) {
  // Invalid quantity or malformed time is rejected separately.
  if (!Number.isInteger(kg) || kg < 1) {
    return {
      invalidInput:
        "Quantity must be a whole number of at least 1 kg.",
      reasons: [],
    };
  }

  const plannedMinute = parseLocalMinutes(plannedTime);

  if (plannedMinute === null) {
    return {
      invalidInput:
        "Planned pickup must be a valid date and time in YYYY-MM-DDTHH:MM format.",
      reasons: [],
    };
  }

  const reasons = [];
  const status = donationStatus(donation);
  const nowMinute = parseLocalMinutes(state.clock);
  const startMinute = parseLocalMinutes(
    donation.pickup_from
  );
  const endMinute = parseLocalMinutes(
    donation.pickup_until
  );

  // Rule 1: donation must not be CANCELLED or EXPIRED.
  if (
    status === "CANCELLED" ||
    status === "EXPIRED"
  ) {
    reasons.push(
      `Rule 1: donation is ${status.toLowerCase()}.`
    );
  }

  // Rule 2: kilograms cannot exceed volunteer capacity.
  if (kg > volunteer.capacity_kg) {
    reasons.push(
      `Rule 2: quantity exceeds volunteer capacity of ${volunteer.capacity_kg} kg.`
    );
  }

  // Rule 3: kilograms cannot exceed remaining donation quantity.
  const available = remainingKg(donation);

  if (kg > available) {
    reasons.push(
      `Rule 3: only ${available} kg remain.`
    );
  }

  // Rule 4: volunteer must be allowed to collect in this zone.
  const donor = getDonor(donation.donor_id);

  if (
    !donor ||
    !volunteer.zones.includes(donor.zone)
  ) {
    reasons.push(
      `Rule 4: volunteer cannot collect from the ${donor?.zone ?? "unknown"} zone.`
    );
  }

  // Rule 5: planned pickup must be within the window, inclusive.
  if (
    startMinute === null ||
    endMinute === null ||
    plannedMinute < startMinute ||
    plannedMinute > endMinute
  ) {
    reasons.push(
      "Rule 5: planned pickup must be within the donation pickup window."
    );
  }

  // Rule 6: planned pickup cannot precede simulated time.
  if (
    nowMinute === null ||
    plannedMinute < nowMinute
  ) {
    reasons.push(
      "Rule 6: planned pickup cannot be before the simulated clock."
    );
  }

  // Rule 7: compare against all ACTIVE/COLLECTED claims belonging
  // to this volunteer, even when they concern other donations.
  // Exactly 60 minutes is allowed.
  const conflicts = state.claims.filter((claim) => {
    if (
      claim.volunteer_id !== volunteer.id ||
      !["ACTIVE", "COLLECTED"].includes(claim.status)
    ) {
      return false;
    }

    const existingMinute = parseLocalMinutes(
      claim.planned_time
    );

    return (
      existingMinute !== null &&
      Math.abs(existingMinute - plannedMinute) < 60
    );
  });

  if (conflicts.length > 0) {
    reasons.push(
      `Rule 7: pickup must be at least 60 minutes from claim(s) ${conflicts
        .map((claim) => claim.id)
        .join(", ")}.`
    );
  }

  return {
    invalidInput: null,
    reasons,
  };
}

// Health endpoint.
app.get("/", (_req, res) => {
  res.send("SurplusLink API is running");
});

// Current application state.
app.get("/api/state", (_req, res) => {
  updateMissedClaims();

  res.json({
    ...state,

    donations: state.donations.map((donation) => ({
      ...donation,
      zone:
        getDonor(donation.donor_id)?.zone ?? null,
      remaining_kg: remainingKg(donation),
      status: donationStatus(donation),
    })),
  });
});

// Move simulated clock forward only.
app.post("/api/clock", (req, res) => {
  const { clock } = req.body ?? {};

  const nextMinute = parseLocalMinutes(clock);
  const currentMinute = parseLocalMinutes(state.clock);

  if (nextMinute === null) {
    return formatError(
      res,
      400,
      "Clock must be a valid date and time in YYYY-MM-DDTHH:MM format."
    );
  }

  if (nextMinute < currentMinute) {
    addHistory(
      "SYSTEM",
      "ADVANCE_CLOCK",
      null,
      "REFUSED",
      "The simulated clock cannot move backwards."
    );

    saveState();

    return formatError(
      res,
      400,
      "The simulated clock cannot move backwards."
    );
  }

  state.clock = clock;

  updateMissedClaims();

  addHistory(
    "SYSTEM",
    "ADVANCE_CLOCK",
    null,
    "SUCCESS",
    clock
  );

  saveState();

  res.json({
    clock: state.clock,
    message: "Simulated clock updated.",
  });
});

// Post a donation.
app.post("/api/donations", (req, res) => {
  const {
    donor_id,
    description,
    quantity_kg,
    pickup_from,
    pickup_until,
  } = req.body ?? {};

  const donor = getDonor(donor_id);

  if (
    !donor ||
    typeof description !== "string" ||
    !description.trim()
  ) {
    return formatError(
      res,
      400,
      "A valid donor and non-empty description are required."
    );
  }

  if (
    !Number.isInteger(quantity_kg) ||
    quantity_kg < 1
  ) {
    return formatError(
      res,
      400,
      "Quantity must be a whole number of at least 1 kg."
    );
  }

  const start = parseLocalMinutes(pickup_from);
  const end = parseLocalMinutes(pickup_until);
  const now = parseLocalMinutes(state.clock);

  if (start === null || end === null) {
    return formatError(
      res,
      400,
      "Pickup times must be valid date-times in YYYY-MM-DDTHH:MM format."
    );
  }

  if (start >= end || end < now) {
    return formatError(
      res,
      400,
      "Pickup start must be before pickup end, and pickup end cannot be before the simulated clock."
    );
  }

  const donation = {
    id: createId("DN"),
    donor_id,
    description: description.trim(),
    quantity_kg,
    pickup_from,
    pickup_until,
  };

  state.donations.push(donation);

  addHistory(
    donor_id,
    "POST_DONATION",
    donation.id,
    "SUCCESS",
    `${quantity_kg} kg`
  );

  saveState();

  res.status(201).json(donation);
});

// Cancel a donation.
app.post("/api/donations/:id/cancel", (req, res) => {
  const donation = getDonation(req.params.id);

  if (!donation) {
    return formatError(
      res,
      404,
      "Donation not found."
    );
  }

  const actor = getDonor(req.body?.donor_id);

  if (!actor || actor.id !== donation.donor_id) {
    addHistory(
      req.body?.donor_id,
      "CANCEL_DONATION",
      donation.id,
      "REFUSED",
      "Only the owning donor can cancel."
    );

    saveState();

    return formatError(
      res,
      403,
      "Only the owning donor can cancel this donation."
    );
  }

  const status = donationStatus(donation);

  const hasActiveOrCollectedClaims =
    state.claims.some(
      (claim) =>
        claim.donation_id === donation.id &&
        ["ACTIVE", "COLLECTED"].includes(claim.status)
    );

  if (
    status !== "OPEN" ||
    hasActiveOrCollectedClaims
  ) {
    addHistory(
      actor.id,
      "CANCEL_DONATION",
      donation.id,
      "REFUSED",
      "Donation is not OPEN or has ACTIVE/COLLECTED claims."
    );

    saveState();

    return formatError(
      res,
      400,
      "A donation can be cancelled only while OPEN and with no ACTIVE or COLLECTED claims."
    );
  }

  state.cancelledDonations.push(donation.id);

  addHistory(
    actor.id,
    "CANCEL_DONATION",
    donation.id,
    "SUCCESS"
  );

  saveState();

  res.json({
    message: "Donation cancelled.",
  });
});

// Claim some kilograms of a donation.
app.post("/api/claims", (req, res) => {
  const {
    volunteer_id,
    donation_id,
    kg,
    planned_time,
  } = req.body ?? {};

  const volunteer = getVolunteer(volunteer_id);
  const donation = getDonation(donation_id);

  if (!volunteer || !donation) {
    return formatError(
      res,
      404,
      "Volunteer or donation not found."
    );
  }

  const validation = validateClaim(
    volunteer,
    donation,
    kg,
    planned_time
  );

  if (validation.invalidInput) {
    addHistory(
      volunteer.id,
      "CLAIM",
      donation.id,
      "INVALID_INPUT",
      validation.invalidInput
    );

    saveState();

    return formatError(
      res,
      400,
      validation.invalidInput
    );
  }

  if (validation.reasons.length > 0) {
    const detail = validation.reasons.join(" ");

    addHistory(
      volunteer.id,
      "CLAIM",
      donation.id,
      "REFUSED",
      detail
    );

    saveState();

    return res.status(400).json({
      reasons: validation.reasons,
    });
  }

  // Validation and insertion run synchronously in this Node process,
  // so the same remaining kilograms cannot be claimed concurrently
  // by another request handled by this process.
  const claim = {
    id: createId("C"),
    donation_id,
    volunteer_id,
    kg,
    planned_time,
    status: "ACTIVE",
  };

  state.claims.push(claim);

  addHistory(
    volunteer.id,
    "CLAIM",
    donation.id,
    "SUCCESS",
    `${kg} kg`
  );

  saveState();

  res.status(201).json(claim);
});

// Collect an active claim.
app.post("/api/claims/:id/collect", (req, res) => {
  updateMissedClaims();

  const claim = state.claims.find(
    (item) => item.id === req.params.id
  );

  if (!claim) {
    return formatError(
      res,
      404,
      "Claim not found."
    );
  }

  if (
    claim.volunteer_id !== req.body?.volunteer_id ||
    claim.status !== "ACTIVE"
  ) {
    addHistory(
      req.body?.volunteer_id,
      "COLLECT",
      claim.donation_id,
      "REFUSED",
      "Only the owning volunteer can collect an ACTIVE claim."
    );

    saveState();

    return formatError(
      res,
      400,
      "Only the owning volunteer can collect their ACTIVE claim."
    );
  }

  const donation = getDonation(claim.donation_id);
  const now = parseLocalMinutes(state.clock);
  const start = parseLocalMinutes(donation?.pickup_from);
  const end = parseLocalMinutes(donation?.pickup_until);

  if (
    start === null ||
    end === null ||
    now < start ||
    now > end
  ) {
    addHistory(
      claim.volunteer_id,
      "COLLECT",
      claim.donation_id,
      "REFUSED",
      "Collection is only allowed within the pickup window."
    );

    saveState();

    return formatError(
      res,
      400,
      "Collection is allowed only when the simulated clock is within the pickup window."
    );
  }

  claim.status = "COLLECTED";

  addHistory(
    claim.volunteer_id,
    "COLLECT",
    donation.id,
    "SUCCESS",
    `${claim.kg} kg`
  );

  saveState();

  res.json(claim);
});

// Cancel an active claim strictly before planned pickup time.
app.post("/api/claims/:id/cancel", (req, res) => {
  const claim = state.claims.find(
    (item) => item.id === req.params.id
  );

  if (!claim) {
    return formatError(
      res,
      404,
      "Claim not found."
    );
  }

  const now = parseLocalMinutes(state.clock);
  const planned = parseLocalMinutes(claim.planned_time);

  if (
    claim.volunteer_id !== req.body?.volunteer_id ||
    claim.status !== "ACTIVE" ||
    now === null ||
    planned === null ||
    now >= planned
  ) {
    addHistory(
      req.body?.volunteer_id,
      "CANCEL_CLAIM",
      claim.donation_id,
      "REFUSED",
      "Only the owning volunteer may cancel an ACTIVE claim strictly before its planned pickup time."
    );

    saveState();

    return formatError(
      res,
      400,
      "A claim can be cancelled only by its owner while ACTIVE and strictly before its planned pickup time."
    );
  }

  claim.status = "CANCELLED";

  addHistory(
    claim.volunteer_id,
    "CANCEL_CLAIM",
    claim.donation_id,
    "SUCCESS",
    `${claim.kg} kg returned`
  );

  saveState();

  res.json(claim);
});

// Dashboard and accounting calculations.
app.get("/api/dashboard", (_req, res) => {
  updateMissedClaims();

  // All dashboard figures exclude CANCELLED donations.
  const donations = state.donations.filter(
    (donation) =>
      donationStatus(donation) !== "CANCELLED"
  );

  const donationIds = new Set(
    donations.map((donation) => donation.id)
  );

  const sumKg = (claims) =>
    claims
      .filter((claim) =>
        donationIds.has(claim.donation_id)
      )
      .reduce(
        (total, claim) => total + claim.kg,
        0
      );

  const listed = donations.reduce(
    (total, donation) =>
      total + donation.quantity_kg,
    0
  );

  const collected = sumKg(
    state.claims.filter(
      (claim) => claim.status === "COLLECTED"
    )
  );

  const missed = sumKg(
    state.claims.filter(
      (claim) => claim.status === "MISSED"
    )
  );

  const inProgress = sumKg(
    state.claims.filter(
      (claim) => claim.status === "ACTIVE"
    )
  );

  const wasted = donations
    .filter(
      (donation) =>
        donationStatus(donation) === "EXPIRED"
    )
    .reduce(
      (total, donation) =>
        total + remainingKg(donation),
      0
    );

  const stillOpen = donations
    .filter(
      (donation) =>
        donationStatus(donation) !== "EXPIRED"
    )
    .reduce(
      (total, donation) =>
        total + remainingKg(donation),
      0
    );

  const donorStats = state.donors.map((donor) => ({
    donor: donor.name,

    collected_kg: state.claims
      .filter(
        (claim) =>
          claim.status === "COLLECTED" &&
          donationIds.has(claim.donation_id) &&
          getDonation(claim.donation_id)?.donor_id === donor.id
      )
      .reduce(
        (total, claim) => total + claim.kg,
        0
      ),
  }));

  const volunteerStats = state.volunteers.map(
    (volunteer) => ({
      volunteer: volunteer.name,

      collected_kg: state.claims
        .filter(
          (claim) =>
            claim.volunteer_id === volunteer.id &&
            claim.status === "COLLECTED" &&
            donationIds.has(claim.donation_id)
        )
        .reduce(
          (total, claim) => total + claim.kg,
          0
        ),

      missed_claims: state.claims.filter(
        (claim) =>
          claim.volunteer_id === volunteer.id &&
          claim.status === "MISSED" &&
          donationIds.has(claim.donation_id)
      ).length,
    })
  );

  const accounted =
    collected +
    missed +
    wasted +
    inProgress +
    stillOpen;

  res.json({
    listed,
    collected,
    missed,
    wasted,
    in_progress: inProgress,
    still_open: stillOpen,
    accounted,
    balanced: listed === accounted,
    donorStats,
    volunteerStats,
  });
});

// Return clear errors for malformed JSON and unexpected failures.
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return formatError(
      res,
      400,
      "Request body must contain valid JSON."
    );
  }

  console.error(err);

  return formatError(
    res,
    500,
    "Internal server error."
  );
});

app.listen(PORT, () => {
  console.log(
    `SurplusLink API running at http://localhost:${PORT}`
  );
});
