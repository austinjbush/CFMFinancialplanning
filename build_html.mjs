#!/usr/bin/env node
/**
 * Builds a standalone HTML file from PhysicianFinancialPlanner.jsx.
 * Replaces import statements with CDN globals, substitutes lucide-react
 * icons with inline SVG components, wraps in HTML with Babel standalone compiler.
 *
 * CDN dependencies: React, ReactDOM, Babel Standalone, Recharts, Lodash, Tailwind CSS
 * NO lucide-react CDN — icons are inlined as SVG components.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsxPath = join(__dirname, 'PhysicianFinancialPlanner.jsx');
const outFilename = process.argv[2] || 'PhysicianFinancialPlanner.html';
const outPath = join(__dirname, outFilename);

let jsx = readFileSync(jsxPath, 'utf-8');

// Remove import statements
jsx = jsx.replace(/^import React,.*from\s+'react';\s*$/m, '');
jsx = jsx.replace(/^import \{.*\}\s*from\s+'recharts';\s*$/m, '');
jsx = jsx.replace(/^import \{.*\}\s*from\s+'lucide-react';\s*$/m, '');
jsx = jsx.replace(/^import \{.*\}\s*from\s+'lodash';\s*$/m, '');

// Remove export default
jsx = jsx.replace(/^export default PhysicianFinancialPlanner;\s*$/m, '');

// ── Zero out personal financial defaults for distribution ──────────────
// Replace useState(NUMBER) with useState(0) for dollar amounts, rates, percentages
// but preserve structural defaults (splits, allocation, ages, tax rate, filing status).
const zeroDefaults = {
  // Income
  baseSalary: 0, trueUpPayments: 0, spouseIncome: 0,
  // Contributions
  deferralPercentage: 0, yearsOfService: 0, deferral457bPercentage: 0,
  rothIraContrib: 0, spouseRothIra: 0,
  spouseEmployerDeferral: 0, spouseEmployerMatch: 0,
  hsaContribution: 0,
  // Balances
  balance401k: 0, balance457b: 0, balance401a: 0,
  balanceRothIra: 0, balanceHsa: 0,
  spousePreTaxBalance: 0, spouseRothBalance: 0,
  taxableBrokerage: 0, savingsBalance: 0,
  // Budget & Debt
  monthlySpending: 0,
  studentLoanBalance: 0, studentLoanRate: 0, studentLoanPayment: 0,
  mortgageBalance: 0, mortgageRate: 0, mortgagePayment: 0,
  monthlyTaxableInvestment: 0,
};
for (const [varName, val] of Object.entries(zeroDefaults)) {
  // Match: const [varName, setVarName] = useState(ANYTHING);
  const re = new RegExp(
    `(const \\[${varName},\\s*set\\w+\\]\\s*=\\s*useState\\()([^)]+)(\\))`,
  );
  jsx = jsx.replace(re, `$1${val}$3`);
}
// Flip filing status to Single and spouse toggle off for clean slate
jsx = jsx.replace(
  /useState\('MFJ'\)/,
  "useState('Single')"
);
jsx = jsx.replace(
  /const \[includeSpouse, setIncludeSpouse\] = useState\(true\)/,
  "const [includeSpouse, setIncludeSpouse] = useState(false)"
);
// HSA coverage to self (no spouse by default)
jsx = jsx.replace(
  /const \[hsaCoverage, setHsaCoverage\] = useState\('family'\)/,
  "const [hsaCoverage, setHsaCoverage] = useState('self')"
);
// Neutral age
jsx = jsx.replace(
  /const \[currentAge, setCurrentAge\] = useState\(\d+\)/,
  "const [currentAge, setCurrentAge] = useState(35)"
);

// Inline SVG icon components to replace lucide-react
// Each mirrors the lucide-react API: accepts className prop, renders an SVG.
const inlineIcons = `
// ── Inline SVG icon components (replace lucide-react) ──────────────────
const svgIcon = (pathD, className) => React.createElement('svg', {
  xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  className: className || 'w-4 h-4'
}, typeof pathD === 'string'
  ? React.createElement('path', { d: pathD })
  : pathD.map((p, i) => React.createElement(p.tag || 'path', { key: i, ...p }))
);

const Info = ({ className }) => svgIcon([
  { tag: 'circle', cx: '12', cy: '12', r: '10' },
  { tag: 'line', x1: '12', y1: '16', x2: '12', y2: '12' },
  { tag: 'line', x1: '12', y1: '8', x2: '12.01', y2: '8' }
], className);

const Download = ({ className }) => svgIcon([
  { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
  { tag: 'polyline', points: '7 10 12 15 17 10' },
  { tag: 'line', x1: '12', y1: '15', x2: '12', y2: '3' }
], className);

const Upload = ({ className }) => svgIcon([
  { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
  { tag: 'polyline', points: '17 8 12 3 7 8' },
  { tag: 'line', x1: '12', y1: '3', x2: '12', y2: '15' }
], className);

const TrendingUp = ({ className }) => svgIcon([
  { tag: 'polyline', points: '23 6 13.5 15.5 8.5 10.5 1 18' },
  { tag: 'polyline', points: '17 6 23 6 23 12' }
], className);

const DollarSign = ({ className }) => svgIcon([
  { tag: 'line', x1: '12', y1: '1', x2: '12', y2: '23' },
  { d: 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' }
], className);

const PiggyBank = ({ className }) => svgIcon([
  { d: 'M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2' },
  { d: 'M2 9.5a1 1 0 1 0 2 0 1 1 0 0 0-2 0' },
  { tag: 'circle', cx: '15.5', cy: '9.5', r: '0.5', fill: 'currentColor', stroke: 'none' }
], className);

const Home = ({ className }) => svgIcon([
  { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { tag: 'polyline', points: '9 22 9 12 15 12 15 22' }
], className);

const Clock = ({ className }) => svgIcon([
  { tag: 'circle', cx: '12', cy: '12', r: '10' },
  { tag: 'polyline', points: '12 6 12 12 16 14' }
], className);

const ChevronDown = ({ className }) => svgIcon([
  { tag: 'polyline', points: '6 9 12 15 18 9' }
], className);

const ChevronUp = ({ className }) => svgIcon([
  { tag: 'polyline', points: '18 15 12 9 6 15' }
], className);
`;

// Add destructuring from globals at the top (NO lucide-react)
const preamble = `
// Destructure from globals (loaded via CDN)
const { useState, useEffect, useCallback, useMemo, useRef } = React;
const { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } = Recharts;
const debounce = _.debounce;

${inlineIcons}
`;

jsx = preamble + '\n' + jsx;

// Escape closing script tags inside JSX strings (rare but safe)
jsx = jsx.replace(/<\/script>/gi, '<\\/script>');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Physician Financial Planner</title>

  <!-- Diagnostic: shows exactly what fails -->
  <script>
    window.__cdnStatus = {};
    window.__cdnLoaded = function(name) { window.__cdnStatus[name] = 'ok'; };
    window.__cdnFailed = function(name) { window.__cdnStatus[name] = 'FAILED'; };
    window.addEventListener('error', function(e) {
      var el = document.getElementById('boot-errors');
      if (el) el.innerHTML += '<div style="color:#dc2626;margin:4px 0">' + (e.message || e) + '</div>';
    });
  </script>

  <script src="https://unpkg.com/react@18.2.0/umd/react.production.min.js"
          onload="__cdnLoaded('React')" onerror="__cdnFailed('React')"></script>
  <script src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"
          onload="__cdnLoaded('ReactDOM')" onerror="__cdnFailed('ReactDOM')"></script>
  <script src="https://unpkg.com/@babel/standalone@7.23.9/babel.min.js"
          onload="__cdnLoaded('Babel')" onerror="__cdnFailed('Babel')"></script>
  <script src="https://unpkg.com/prop-types@15.8.1/prop-types.min.js"
          onload="__cdnLoaded('PropTypes')" onerror="__cdnFailed('PropTypes')"></script>
  <script src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js"
          onload="__cdnLoaded('Recharts')" onerror="__cdnFailed('Recharts')"></script>
  <script src="https://unpkg.com/lodash@4.17.21/lodash.min.js"
          onload="__cdnLoaded('Lodash')" onerror="__cdnFailed('Lodash')"></script>
  <link href="https://unpkg.com/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    .recharts-tooltip-wrapper { z-index: 1000 !important; }
  </style>

  <!-- Post-load verification: runs after all script tags are parsed -->
  <script>
    (function() {
      var missing = [];
      if (typeof React === 'undefined') missing.push('React');
      if (typeof ReactDOM === 'undefined') missing.push('ReactDOM');
      if (typeof Babel === 'undefined') missing.push('Babel');
      if (typeof PropTypes === 'undefined') missing.push('PropTypes');
      if (typeof Recharts === 'undefined') missing.push('Recharts');
      if (typeof _ === 'undefined') missing.push('Lodash');
      if (missing.length > 0) {
        document.addEventListener('DOMContentLoaded', function() {
          var r = document.getElementById('root');
          r.innerHTML =
            '<div style="max-width:600px;margin:80px auto;font-family:system-ui;text-align:center;padding:24px">' +
            '<h2 style="color:#dc2626;font-size:1.5rem;margin-bottom:12px">Failed to load: ' + missing.join(', ') + '</h2>' +
            '<p style="color:#555;line-height:1.6">This application requires internet access to load JavaScript libraries from <code>unpkg.com</code>.' +
            ' Please check your network connection or firewall/proxy settings and reload.</p>' +
            '<p style="margin-top:8px;font-size:0.85rem;color:#888">CDN status: ' + JSON.stringify(window.__cdnStatus) + '</p>' +
            '<p style="margin-top:16px"><button onclick="location.reload()" ' +
            'style="background:#2563eb;color:white;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:1rem">' +
            'Retry</button></p></div>';
        });
        throw new Error('Missing dependencies: ' + missing.join(', '));
      }
      console.log('[PhysicianFinancialPlanner] All CDN libraries loaded. CDN status:', window.__cdnStatus);
    })();
  </script>
</head>
<body>
  <div id="root">
    <p style="text-align:center;padding:40px;color:#666">Compiling application…</p>
    <div id="boot-errors" style="max-width:600px;margin:0 auto;padding:0 24px;font-family:monospace;font-size:13px"></div>
  </div>
  <script type="text/babel" data-type="module">
${jsx}

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(PhysicianFinancialPlanner));
  <\/script>
</body>
</html>`;

writeFileSync(outPath, html, 'utf-8');
console.log(`✓ HTML written to: ${outPath}`);
console.log(`  Size: ${(html.length / 1024).toFixed(0)} KB`);
