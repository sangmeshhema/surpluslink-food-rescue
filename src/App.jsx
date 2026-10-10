
import { useEffect, useState } from "react";
import "./App.css";

const API = "http://localhost:5000/api";

// Parse the problem statement's timezone-free local datetime.
// UTC is used only for safe arithmetic; the real system clock is never used.
function toMinutes(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return NaN;
  }

  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  return Date.UTC(year, month - 1, day, hour, minute) / 60000;
}

function fromMinutes(value) {
  if (!Number.isFinite(value)) return "";

  const date = new Date(value * 60000);
  const pad = (n) => String(n).padStart(2, "0");

  return (
    `${date.getUTCFullYear()}-` +
    `${pad(date.getUTCMonth() + 1)}-` +
    `${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}:` +
    `${pad(date.getUTCMinutes())}`
  );
}

// Select the earliest time that obeys the clock, pickup window,
// and 60-minute spacing rule for this volunteer.
function getDefaultPickupTime(data, donation, volunteerId) {
  const clockMinute = toMinutes(data.clock);
  const startMinute = toMinutes(donation.pickup_from);
  const endMinute = toMinutes(donation.pickup_until);

  if (
    !Number.isFinite(clockMinute) ||
    !Number.isFinite(startMinute) ||
    !Number.isFinite(endMinute)
  ) {
    return "";
  }

  let candidate = Math.max(clockMinute, startMinute);

  if (candidate > endMinute) return "";

  const existingPickupTimes = (data.claims || [])
    .filter(
      (claim) =>
        claim.volunteer_id === volunteerId &&
        ["ACTIVE", "COLLECTED"].includes(claim.status)
    )
    .map((claim) => toMinutes(claim.planned_time))
    .filter(Number.isFinite);

  while (
    candidate <= endMinute &&
    existingPickupTimes.some(
      (existing) => Math.abs(existing - candidate) < 60
    )
  ) {
    candidate += 1;
  }

  return candidate <= endMinute ? fromMinutes(candidate) : "";
}

export default function App() {
  const [data, setData] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [personId, setPersonId] = useState("V1");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [clock, setClock] = useState("");
  const [claimForms, setClaimForms] = useState({});

  const [donationForm, setDonationForm] = useState({
    description: "",
    quantity_kg: "10",
    pickup_from: "2026-03-10T18:00",
    pickup_until: "2026-03-10T20:00",
  });

  async function load() {
    try {
      const [stateResponse, dashboardResponse] = await Promise.all([
        fetch(`${API}/state`),
        fetch(`${API}/dashboard`),
      ]);

      if (!stateResponse.ok || !dashboardResponse.ok) {
        throw new Error("Unable to load application data.");
      }

      const state = await stateResponse.json();
      const dashboardData = await dashboardResponse.json();

      setData(state);
      setDashboard(dashboardData);
      setClock(state.clock);
      setError("");
    } catch {
      setError(
        "Cannot connect to the backend. Make sure the server is running on port 5000."
      );
    }
  }

  useEffect(() => {
    load();
  }, []);

  const person =
    data?.donors.find((item) => item.id === personId) ||
    data?.volunteers.find((item) => item.id === personId);

  const isDonor = personId.startsWith("D");

  async function action(path, body) {
    setMessage("");
    setError("");

    try {
      const response = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          (result.reasons || [result.error || "Action failed."]).join("\n")
        );
      }

      setMessage(result.message || "Action completed successfully.");

      // Recalculate default pickup times after the simulated clock changes.
      if (path === "/clock") {
        setClaimForms({});
      }

      await load();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    }
  }

  function updateClaimForm(donationId, field, value) {
    setClaimForms((previous) => ({
      ...previous,
      [donationId]: {
        ...previous[donationId],
        [field]: value,
      },
    }));
  }

  if (!data) {
    return (
      <main className="app">
        <h1>
          Surplus<span>Link</span>
        </h1>
        <p>Connecting to the backend...</p>
        {error && <pre className="notice error">{error}</pre>}
        <button onClick={load}>Retry connection</button>
      </main>
    );
  }

  const visibleDonations = data.donations.filter((donation) => {
    if (isDonor) {
      return donation.donor_id === personId;
    }

    const volunteer = data.volunteers.find(
      (item) => item.id === personId
    );

    return (
      volunteer?.zones.includes(donation.zone) &&
      donation.status === "OPEN"
    );
  });

  const ownClaims = data.claims.filter(
    (claim) => claim.volunteer_id === personId
  );

  const pickupStartMinimum = (donation) =>
    fromMinutes(
      Math.max(toMinutes(data.clock), toMinutes(donation.pickup_from))
    );

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">COMMUNITY FOOD RESCUE</p>
          <h1>
            Surplus<span>Link</span>
          </h1>
          <p>Every kilogram rescued makes a difference.</p>
        </div>

        <div className="identity">
          <label htmlFor="person">Acting as</label>
          <select
            id="person"
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
          >
            <optgroup label="Restaurants">
              {data.donors.map((donor) => (
                <option key={donor.id} value={donor.id}>
                  {donor.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Volunteers">
              {data.volunteers.map((volunteer) => (
                <option key={volunteer.id} value={volunteer.id}>
                  {volunteer.name}
                </option>
              ))}
            </optgroup>
          </select>
          <strong>{person?.name}</strong>
          <small>
            {isDonor
              ? `Restaurant · ${person?.zone}`
              : `Volunteer · ${person?.capacity_kg} kg capacity`}
          </small>
        </div>
      </header>

      {error && <pre className="notice error">{error}</pre>}
      {message && <div className="notice success">{message}</div>}

      <section className="stats">
        {[
          ["Listed", dashboard?.listed],
          ["Collected", dashboard?.collected],
          ["Missed", dashboard?.missed],
          ["Wasted", dashboard?.wasted],
          ["In progress", dashboard?.in_progress],
          ["Still open", dashboard?.still_open],
        ].map(([label, value]) => (
          <article className="stat" key={label}>
            <span>{label}</span>
            <strong>
              {value ?? 0}
              <small> kg</small>
            </strong>
          </article>
        ))}
      </section>

      <section className="panel clock-panel">
        <div>
          <p className="eyebrow">SIMULATED PICKUP CLOCK</p>
          <h2>Rescue timeline</h2>
          <p>Advance the simulated time to test pickup windows and expiry.</p>
        </div>

        <div className="clock-control">
          <input
            type="datetime-local"
            aria-label="Simulated date and time"
            value={clock}
            onChange={(event) => setClock(event.target.value)}
          />
          <button onClick={() => action("/clock", { clock })}>
            Advance clock
          </button>
        </div>
      </section>

      {isDonor ? (
        <section className="panel">
          <p className="eyebrow">RESTAURANT PORTAL</p>
          <h2>Post surplus food</h2>

          <form
            onSubmit={(event) => {
              event.preventDefault();

              action("/donations", {
                donor_id: personId,
                description: donationForm.description,
                quantity_kg: Number(donationForm.quantity_kg),
                pickup_from: donationForm.pickup_from,
                pickup_until: donationForm.pickup_until,
              });
            }}
          >
            <label>
              Food description
              <input
                required
                value={donationForm.description}
                onChange={(event) =>
                  setDonationForm((previous) => ({
                    ...previous,
                    description: event.target.value,
                  }))
                }
                placeholder="e.g. Fresh vegetable meals"
              />
            </label>

            <label>
              Quantity (kg)
              <input
                required
                type="number"
                min="1"
                step="1"
                value={donationForm.quantity_kg}
                onChange={(event) =>
                  setDonationForm((previous) => ({
                    ...previous,
                    quantity_kg: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              Pickup from
              <input
                required
                type="datetime-local"
                min={data.clock}
                value={donationForm.pickup_from}
                onChange={(event) =>
                  setDonationForm((previous) => ({
                    ...previous,
                    pickup_from: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              Pickup until
              <input
                required
                type="datetime-local"
                min={donationForm.pickup_from}
                value={donationForm.pickup_until}
                onChange={(event) =>
                  setDonationForm((previous) => ({
                    ...previous,
                    pickup_until: event.target.value,
                  }))
                }
              />
            </label>

            <button type="submit">Post donation</button>
          </form>
        </section>
      ) : (
        <section className="panel">
          <p className="eyebrow">VOLUNTEER PORTAL</p>
          <h2>Available in your zones</h2>
          <p className="muted">
            Only open donations in your permitted zones are shown.
          </p>

          <div className="donation-grid">
            {visibleDonations.map((donation) => {
              const claimForm = claimForms[donation.id] || {};

              const defaultPickupTime = getDefaultPickupTime(
                data,
                donation,
                personId
              );

              const quantity = claimForm.kg ?? "5";
              const plannedTime =
                claimForm.planned_time ?? defaultPickupTime;

              return (
                <article className="donation" key={donation.id}>
                  <div className="donation-head">
                    <span className="pill">{donation.zone}</span>
                    <span className="pill open">{donation.status}</span>
                  </div>

                  <h3>{donation.description}</h3>
                  <p>
                    {
                      data.donors.find(
                        (donor) => donor.id === donation.donor_id
                      )?.name
                    }
                  </p>

                  <div className="quantity">
                    <strong>{donation.remaining_kg} kg</strong>
                    <span>remaining</span>
                  </div>

                  <p className="muted">
                    {donation.pickup_from.replace("T", " ")} –{" "}
                    {donation.pickup_until.replace("T", " ")}
                  </p>

                  <form
                    onSubmit={(event) => {
                      event.preventDefault();

                      action("/claims", {
                        volunteer_id: personId,
                        donation_id: donation.id,
                        kg: Number(quantity),
                        planned_time: plannedTime,
                      });
                    }}
                  >
                    <label>
                      Quantity (kg)
                      <input
                        type="number"
                        min="1"
                        max={donation.remaining_kg}
                        step="1"
                        required
                        value={quantity}
                        onChange={(event) =>
                          updateClaimForm(
                            donation.id,
                            "kg",
                            event.target.value
                          )
                        }
                      />
                    </label>

                    <label>
                      Planned pickup
                      <input
                        type="datetime-local"
                        required
                        min={pickupStartMinimum(donation)}
                        max={donation.pickup_until}
                        value={plannedTime}
                        onChange={(event) =>
                          updateClaimForm(
                            donation.id,
                            "planned_time",
                            event.target.value
                          )
                        }
                      />

                      {!plannedTime && (
                        <small className="muted">
                          No valid pickup time remains in this window.
                        </small>
                      )}
                    </label>

                    <button type="submit" disabled={!plannedTime}>
                      Reserve food
                    </button>
                  </form>
                </article>
              );
            })}

            {visibleDonations.length === 0 && (
              <p>No open donations are available in your zones.</p>
            )}
          </div>
        </section>
      )}

      {isDonor && (
        <section className="panel">
          <p className="eyebrow">YOUR INVENTORY</p>
          <h2>Your donations</h2>

          <div className="donation-grid">
            {visibleDonations.map((donation) => {
              const relatedClaims = data.claims.filter(
                (claim) => claim.donation_id === donation.id
              );

              return (
                <article className="donation" key={donation.id}>
                  <span className="pill">{donation.status}</span>
                  <h3>{donation.description}</h3>
                  <p>
                    {donation.remaining_kg} kg remaining of{" "}
                    {donation.quantity_kg} kg
                  </p>
                  <p className="muted">
                    {donation.pickup_from.replace("T", " ")} –{" "}
                    {donation.pickup_until.replace("T", " ")}
                  </p>

                  <h4>Claims</h4>
                  {relatedClaims.length === 0 ? (
                    <p className="muted">No claims yet.</p>
                  ) : (
                    relatedClaims.map((claim) => (
                      <p key={claim.id}>
                        {data.volunteers.find(
                          (volunteer) =>
                            volunteer.id === claim.volunteer_id
                        )?.name || claim.volunteer_id}
                        {" · "}
                        {claim.kg} kg · {claim.status}
                      </p>
                    ))
                  )}

                  {donation.status === "OPEN" && (
                    <button
                      className="secondary"
                      onClick={() =>
                        action(`/donations/${donation.id}/cancel`, {
                          donor_id: personId,
                        })
                      }
                    >
                      Cancel donation
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!isDonor && (
        <section className="panel">
          <p className="eyebrow">MY PICKUPS</p>
          <h2>Your claims</h2>

          {ownClaims.length === 0 && (
            <p className="muted">You haven't made any claims yet.</p>
          )}

          <div className="donation-grid">
            {ownClaims.map((claim) => (
              <article className="donation" key={claim.id}>
                <span className="pill">{claim.status}</span>
                <h3>
                  {data.donations.find(
                    (donation) => donation.id === claim.donation_id
                  )?.description || claim.donation_id}
                </h3>
                <p>
                  {claim.kg} kg · {claim.planned_time.replace("T", " ")}
                </p>

                {claim.status === "ACTIVE" && (
                  <>
                    <button
                      onClick={() =>
                        action(`/claims/${claim.id}/collect`, {
                          volunteer_id: personId,
                        })
                      }
                    >
                      Mark collected
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        action(`/claims/${claim.id}/cancel`, {
                          volunteer_id: personId,
                        })
                      }
                    >
                      Cancel claim
                    </button>
                  </>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <p className="eyebrow">ACCOUNTABILITY</p>
        <h2>Rescue integrity</h2>

        <div className="integrity">
          <div>
            <span>Listed</span>
            <strong>{dashboard?.listed ?? 0} kg</strong>
          </div>
          <div>
            <span>Accounted for</span>
            <strong>{dashboard?.accounted ?? 0} kg</strong>
          </div>
          <div>
            <span>Balance check</span>
            <strong className={dashboard?.balanced ? "good" : "bad"}>
              {dashboard?.balanced ? "PASS" : "CHECK"}
            </strong>
          </div>
        </div>

        <button className="secondary" onClick={load}>
          Refresh data
        </button>
      </section>

      <section className="panel">
        <p className="eyebrow">IMPACT REPORT</p>
        <h2>Collected food by restaurant</h2>
        <div className="donation-grid">
          {(dashboard?.donorStats || []).map((item) => (
            <article className="donation" key={item.donor}>
              <h3>{item.donor}</h3>
              <p>{item.collected_kg} kg collected</p>
            </article>
          ))}
        </div>

        <h2>Volunteer performance</h2>
        <div className="donation-grid">
          {(dashboard?.volunteerStats || []).map((item) => (
            <article className="donation" key={item.volunteer}>
              <h3>{item.volunteer}</h3>
              <p>{item.collected_kg} kg collected</p>
              <p>{item.missed_claims} missed claims</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">AUDIT TRAIL</p>
        <h2>Action history</h2>

        {!data.history?.length ? (
          <p className="muted">No actions recorded yet.</p>
        ) : (
          <div className="donation-grid">
            {data.history.map((item) => (
              <article className="donation" key={item.id}>
                <span className="pill">{item.outcome}</span>
                <h3>{item.action}</h3>
                <p>
                  {item.actor} · {item.donation_id}
                </p>
                <p className="muted">
                  {item.time?.replace("T", " ")}
                </p>
                {item.detail && <p>{item.detail}</p>}
              </article>
            ))}
          </div>
        )}
      </section>

      <footer>SurplusLink · Rescue food. Deliver impact.</footer>
    </main>
  );
}
