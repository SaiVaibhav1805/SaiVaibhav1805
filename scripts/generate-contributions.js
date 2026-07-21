// Fetches contribution calendar via GitHub GraphQL API and writes data/contributions.json
const fs = require('fs');
const path = require('path');

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GH_PAT;

if (!USERNAME || !TOKEN) {
  console.error('Missing GH_USERNAME or GH_PAT env vars');
  process.exit(1);
}

const query = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

async function main() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });

  const json = await res.json();
  if (json.errors) {
    console.error(json.errors);
    process.exit(1);
  }

  const calendar = json.data.user.contributionsCollection.contributionCalendar;
  const days = calendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const total = calendar.totalContributions;
  const activeDays = days.filter((d) => d.count > 0);

  // Current streak: walk backward from the most recent day
  let currentStreak = { length: 0, start: null, end: null };
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) {
      if (currentStreak.length === 0) currentStreak.end = days[i].date;
      currentStreak.length++;
      currentStreak.start = days[i].date;
    } else {
      break;
    }
  }

  // Longest streak: scan for max consecutive run
  let longestStreak = { length: 0, start: null, end: null };
  let runLength = 0;
  let runStart = null;
  for (const d of days) {
    if (d.count > 0) {
      if (runLength === 0) runStart = d.date;
      runLength++;
      if (runLength > longestStreak.length) {
        longestStreak = { length: runLength, start: runStart, end: d.date };
      }
    } else {
      runLength = 0;
    }
  }

  const bestDay = days.reduce(
    (best, d) => (d.count > best.count ? d : best),
    { date: null, count: -1 }
  );

  const monthlyMap = {};
  for (const d of days) {
    const month = d.date.slice(0, 7); // YYYY-MM
    monthlyMap[month] = (monthlyMap[month] || 0) + d.count;
  }
  const monthly = Object.entries(monthlyMap)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, t]) => ({ month, total: t }));

  const output = {
    username: USERNAME,
    generated_at: new Date().toISOString(),
    range: {
      start: days[0]?.date ?? null,
      end: days[days.length - 1]?.date ?? null,
    },
    total_contributions: total,
    active_days: activeDays.length,
    avg_per_active_day: activeDays.length
      ? Number((total / activeDays.length).toFixed(1))
      : 0,
    current_streak: currentStreak,
    longest_streak: longestStreak,
    best_day: { date: bestDay.date, count: bestDay.count },
    monthly,
    days,
  };

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'contributions.json'),
    JSON.stringify(output, null, 2)
  );

  console.log(`Wrote contributions.json — ${total} contributions, ${activeDays.length} active days`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
