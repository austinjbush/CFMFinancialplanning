import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ChevronDown, ChevronUp, Info, Download, Upload, DollarSign, TrendingUp, Home, PiggyBank, Clock } from 'lucide-react';
import { debounce } from 'lodash';

// Click-to-toggle tooltip component (replaces broken native title attributes)
const InfoTip = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-blue-500 hover:text-blue-700 focus:outline-none"
        aria-label="More info"
      >
        <Info className="w-4 h-4" />
      </button>
      {open && (
        <span className="absolute left-6 top-0 z-50 w-72 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg leading-relaxed">
          {text}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="block mt-1 text-blue-300 hover:text-blue-100 text-xs underline"
          >
            close
          </button>
        </span>
      )}
    </span>
  );
};

// Wrapper for number inputs that avoids the leading-zero / clear-and-retype bug.
// Keeps a local string while the field is focused; syncs to parent state on blur.
const NumericInput = ({ value, onChange, min = 0, step, prefix, className, ...rest }) => {
  const [localValue, setLocalValue] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);

  // Keep local value in sync when parent state changes AND the field is not focused
  useEffect(() => {
    if (!isFocused) setLocalValue(String(value));
  }, [value, isFocused]);

  const handleChange = (e) => {
    const raw = e.target.value;
    setLocalValue(raw);
    // Live-update parent if the string is a valid number (keeps chart responsive)
    const num = Number(raw);
    if (raw !== '' && !isNaN(num)) {
      onChange(Math.max(min, num));
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const num = Number(localValue);
    if (localValue === '' || isNaN(num)) {
      onChange(min);
      setLocalValue(String(min));
    } else {
      const clamped = Math.max(min, num);
      onChange(clamped);
      setLocalValue(String(clamped));
    }
  };

  const handleFocus = (e) => {
    setIsFocused(true);
    e.target.select(); // select all on focus for easy replacement
  };

  return (
    <div className="flex items-center space-x-2">
      {prefix && <span className="text-lg font-semibold">{prefix}</span>}
      <input
        type="number"
        value={localValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        step={step}
        className={className || "flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"}
        {...rest}
      />
    </div>
  );
};

// Custom tooltip for stacked area charts: hides zero-balance account rows
const StackedTooltip = ({ active, payload, label }) => {
  if (!active || !payload) return null;
  const fmt = (v) => {
    if (Math.abs(v) >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  // Filter out entries whose value rounds to zero
  const visible = payload.filter((entry) => Math.round(entry.value) !== 0);
  if (visible.length === 0) return null;
  const total = visible.reduce((sum, entry) => sum + entry.value, 0);
  return (
    <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '11px', padding: '8px 10px' }}>
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{`Age: ${label}`}</p>
      {visible.map((entry, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: entry.color }}>
          <span>{entry.name}</span>
          <span style={{ fontWeight: 500 }}>{fmt(entry.value)}</span>
        </div>
      ))}
      {visible.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderTop: '1px solid #e5e7eb', marginTop: 4, paddingTop: 4, fontWeight: 700, color: '#111' }}>
          <span>Total</span>
          <span>{fmt(total)}</span>
        </div>
      )}
    </div>
  );
};

const PhysicianFinancialPlanner = () => {
  // State Management
  const [activeTab, setActiveTab] = useState(0);
  const [detailedChart, setDetailedChart] = useState(false); // Toggle between simple net worth and detailed account breakdown
  const [showMonteCarlo, setShowMonteCarlo] = useState(false); // Toggle Monte Carlo fan chart overlay
  const [includeSpouse, setIncludeSpouse] = useState(false); // Toggle spouse/partner income and accounts
  const [showDisclaimer, setShowDisclaimer] = useState(() => {
    try { return !localStorage.getItem('physician-fp-disclaimer-accepted'); } catch { return true; }
  });

  // Scenario comparison — stores a frozen snapshot for overlay comparison
  const [savedScenario, setSavedScenario] = useState(null);

  // Income & Compensation
  const [baseSalary, setBaseSalary] = useState(0);
  const [trueUpPayments, setTrueUpPayments] = useState(0);
  const [filingStatus, setFilingStatus] = useState('Single');
  const [spouseIncome, setSpouseIncome] = useState(0);
  const [useStandardDeduction, setUseStandardDeduction] = useState(true);
  const [itemizedDeduction, setItemizedDeduction] = useState(0);

  // Retirement Contributions - 401(k)
  const [deferralPercentage, setDeferralPercentage] = useState(0);
  const [preVsRothSplit, setPreVsRothSplit] = useState(100); // 100 = all pre-tax, 0 = all Roth
  const [yearsOfService, setYearsOfService] = useState(0);

  // Retirement Contributions - 457(b)
  const [deferral457bPercentage, setDeferral457bPercentage] = useState(0); // Percentage of base salary

  // Retirement Contributions - 401(a)
  const [contribution401a, setContribution401a] = useState(0);

  // Retirement Contributions - IRAs
  const [traditionalIraContrib, setTraditionalIraContrib] = useState(0);
  const [rothIraContrib, setRothIraContrib] = useState(0);
  const [spouseTraditionalIra, setSpouseTraditionalIra] = useState(0);
  const [spouseRothIra, setSpouseRothIra] = useState(0);
  const [spouseEmployerDeferral, setSpouseEmployerDeferral] = useState(0); // Spouse's own deferrals into employer plan (401k/403b/etc.)
  const [spouseEmployerMatch, setSpouseEmployerMatch] = useState(0); // Spouse's employer match contribution
  const [spousePreTaxSplit, setSpousePreTaxSplit] = useState(100); // 100 = all pre-tax, 0 = all Roth

  // Health Savings Account (HSA)
  const [hsaContribution, setHsaContribution] = useState(0);
  const [hsaCoverage, setHsaCoverage] = useState('self'); // 'self' or 'family'

  // Current Account Balances
  const [balance401k, setBalance401k] = useState(0);
  const [balance457b, setBalance457b] = useState(0);
  const [balance401a, setBalance401a] = useState(0);
  const [balanceTraditionalIra, setBalanceTraditionalIra] = useState(0);
  const [balanceRothIra, setBalanceRothIra] = useState(0);
  const [balanceHsa, setBalanceHsa] = useState(0);
  const [spousePreTaxBalance, setSpousePreTaxBalance] = useState(0); // Spouse 401k + 457b + 403b
  const [spouseRothBalance, setSpouseRothBalance] = useState(0); // Spouse Roth IRA
  const [taxableBrokerage, setTaxableBrokerage] = useState(0);
  const [savingsBalance, setSavingsBalance] = useState(0);

  // Household Budget & Debt
  const [monthlySpending, setMonthlySpending] = useState(0);
  const [studentLoanBalance, setStudentLoanBalance] = useState(0);
  const [studentLoanRate, setStudentLoanRate] = useState(5);
  const [studentLoanPayment, setStudentLoanPayment] = useState(0);
  const [mortgageBalance, setMortgageBalance] = useState(0);
  const [mortgageRate, setMortgageRate] = useState(6);
  const [mortgagePayment, setMortgagePayment] = useState(0);
  const [otherDebtBalance, setOtherDebtBalance] = useState(0);
  const [otherDebtRate, setOtherDebtRate] = useState(8);
  const [otherDebtPayment, setOtherDebtPayment] = useState(0);
  const [monthlyTaxableInvestment, setMonthlyTaxableInvestment] = useState(0); // Explicit taxable brokerage contributions

  // Other Assets & Settings
  const [equityAllocation, setEquityAllocation] = useState(90);
  const [currentAge, setCurrentAge] = useState(35);
  const [retirementAge, setRetirementAge] = useState(65);
  const [spouseRetirementAge, setSpouseRetirementAge] = useState(65);
  const [retirementTaxRate, setRetirementTaxRate] = useState(22); // Estimated effective tax rate on pre-tax withdrawals in retirement

  // ── localStorage auto-save/restore ───────────────────────────────────
  const STORAGE_KEY = 'physician-financial-planner-state';

  // Restore from localStorage on first mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      // Only restore if we got a valid object
      if (!d || typeof d !== 'object') return;

      if (d.includeSpouse !== undefined) setIncludeSpouse(d.includeSpouse);
      if (d.baseSalary !== undefined) setBaseSalary(d.baseSalary);
      if (d.trueUpPayments !== undefined) setTrueUpPayments(d.trueUpPayments);
      if (d.filingStatus !== undefined) setFilingStatus(d.filingStatus);
      if (d.spouseIncome !== undefined) setSpouseIncome(d.spouseIncome);
      if (d.useStandardDeduction !== undefined) setUseStandardDeduction(d.useStandardDeduction);
      if (d.itemizedDeduction !== undefined) setItemizedDeduction(d.itemizedDeduction);
      if (d.deferralPercentage !== undefined) setDeferralPercentage(d.deferralPercentage);
      if (d.preVsRothSplit !== undefined) setPreVsRothSplit(d.preVsRothSplit);
      if (d.yearsOfService !== undefined) setYearsOfService(d.yearsOfService);
      if (d.deferral457bPercentage !== undefined) setDeferral457bPercentage(d.deferral457bPercentage);
      if (d.contribution401a !== undefined) setContribution401a(d.contribution401a);
      if (d.traditionalIraContrib !== undefined) setTraditionalIraContrib(d.traditionalIraContrib);
      if (d.rothIraContrib !== undefined) setRothIraContrib(d.rothIraContrib);
      if (d.spouseTraditionalIra !== undefined) setSpouseTraditionalIra(d.spouseTraditionalIra);
      if (d.spouseRothIra !== undefined) setSpouseRothIra(d.spouseRothIra);
      if (d.spouseEmployerDeferral !== undefined) setSpouseEmployerDeferral(d.spouseEmployerDeferral);
      if (d.spouseEmployerMatch !== undefined) setSpouseEmployerMatch(d.spouseEmployerMatch);
      if (d.spousePreTaxSplit !== undefined) setSpousePreTaxSplit(d.spousePreTaxSplit);
      if (d.hsaContribution !== undefined) setHsaContribution(d.hsaContribution);
      if (d.hsaCoverage !== undefined) setHsaCoverage(d.hsaCoverage);
      if (d.balance401k !== undefined) setBalance401k(d.balance401k);
      if (d.balance457b !== undefined) setBalance457b(d.balance457b);
      if (d.balance401a !== undefined) setBalance401a(d.balance401a);
      if (d.balanceTraditionalIra !== undefined) setBalanceTraditionalIra(d.balanceTraditionalIra);
      if (d.balanceRothIra !== undefined) setBalanceRothIra(d.balanceRothIra);
      if (d.balanceHsa !== undefined) setBalanceHsa(d.balanceHsa);
      if (d.spousePreTaxBalance !== undefined) setSpousePreTaxBalance(d.spousePreTaxBalance);
      if (d.spouseRothBalance !== undefined) setSpouseRothBalance(d.spouseRothBalance);
      if (d.taxableBrokerage !== undefined) setTaxableBrokerage(d.taxableBrokerage);
      if (d.savingsBalance !== undefined) setSavingsBalance(d.savingsBalance);
      if (d.monthlySpending !== undefined) setMonthlySpending(d.monthlySpending);
      if (d.studentLoanBalance !== undefined) setStudentLoanBalance(d.studentLoanBalance);
      if (d.studentLoanRate !== undefined) setStudentLoanRate(d.studentLoanRate);
      if (d.studentLoanPayment !== undefined) setStudentLoanPayment(d.studentLoanPayment);
      if (d.mortgageBalance !== undefined) setMortgageBalance(d.mortgageBalance);
      if (d.mortgageRate !== undefined) setMortgageRate(d.mortgageRate);
      if (d.mortgagePayment !== undefined) setMortgagePayment(d.mortgagePayment);
      if (d.otherDebtBalance !== undefined) setOtherDebtBalance(d.otherDebtBalance);
      if (d.otherDebtRate !== undefined) setOtherDebtRate(d.otherDebtRate);
      if (d.otherDebtPayment !== undefined) setOtherDebtPayment(d.otherDebtPayment);
      if (d.monthlyTaxableInvestment !== undefined) setMonthlyTaxableInvestment(d.monthlyTaxableInvestment);
      if (d.equityAllocation !== undefined) setEquityAllocation(d.equityAllocation);
      if (d.currentAge !== undefined) setCurrentAge(d.currentAge);
      if (d.retirementAge !== undefined) setRetirementAge(d.retirementAge);
      if (d.spouseRetirementAge !== undefined) setSpouseRetirementAge(d.spouseRetirementAge);
      if (d.retirementTaxRate !== undefined) setRetirementTaxRate(d.retirementTaxRate);
    } catch (e) {
      console.warn('[PhysicianFinancialPlanner] Failed to restore from localStorage:', e);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save to localStorage (debounced to avoid thrashing on slider drags)
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        const state = {
          includeSpouse, baseSalary, trueUpPayments, filingStatus, spouseIncome,
          useStandardDeduction, itemizedDeduction, deferralPercentage, preVsRothSplit,
          yearsOfService, deferral457bPercentage, contribution401a, traditionalIraContrib,
          rothIraContrib, spouseTraditionalIra, spouseRothIra, spouseEmployerDeferral,
          spouseEmployerMatch, spousePreTaxSplit, hsaContribution, hsaCoverage,
          balance401k, balance457b, balance401a, balanceTraditionalIra, balanceRothIra,
          balanceHsa, spousePreTaxBalance, spouseRothBalance, taxableBrokerage,
          savingsBalance, monthlySpending, studentLoanBalance, studentLoanRate,
          studentLoanPayment, mortgageBalance, mortgageRate, mortgagePayment,
          otherDebtBalance, otherDebtRate, otherDebtPayment, monthlyTaxableInvestment,
          equityAllocation, currentAge, retirementAge, spouseRetirementAge, retirementTaxRate,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        // localStorage full or unavailable — fail silently
      }
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [includeSpouse, baseSalary, trueUpPayments, filingStatus, spouseIncome,
    useStandardDeduction, itemizedDeduction, deferralPercentage, preVsRothSplit,
    yearsOfService, deferral457bPercentage, contribution401a, traditionalIraContrib,
    rothIraContrib, spouseTraditionalIra, spouseRothIra, spouseEmployerDeferral,
    spouseEmployerMatch, spousePreTaxSplit, hsaContribution, hsaCoverage,
    balance401k, balance457b, balance401a, balanceTraditionalIra, balanceRothIra,
    balanceHsa, spousePreTaxBalance, spouseRothBalance, taxableBrokerage,
    savingsBalance, monthlySpending, studentLoanBalance, studentLoanRate,
    studentLoanPayment, mortgageBalance, mortgageRate, mortgagePayment,
    otherDebtBalance, otherDebtRate, otherDebtPayment, monthlyTaxableInvestment,
    equityAllocation, currentAge, retirementAge, spouseRetirementAge, retirementTaxRate]);

  // Derived total compensation
  const totalComp = baseSalary + trueUpPayments;

  // Effective spouse values — zeroed when spouse toggle is off
  // This avoids scattering conditionals through every calculation
  const effSpouseIncome = includeSpouse ? spouseIncome : 0;
  const effSpouseTradIra = includeSpouse ? spouseTraditionalIra : 0;
  const effSpouseRothIra = includeSpouse ? spouseRothIra : 0;
  const effSpousePreTaxBalance = includeSpouse ? spousePreTaxBalance : 0;
  const effSpouseRothBalance = includeSpouse ? spouseRothBalance : 0;
  const effSpouseRetirementAge = includeSpouse ? spouseRetirementAge : retirementAge;
  const effSpouseEmployerDeferral = includeSpouse ? spouseEmployerDeferral : 0;
  const effSpouseEmployerMatch = includeSpouse ? spouseEmployerMatch : 0;
  const effSpouseEmployerTotal = effSpouseEmployerDeferral + effSpouseEmployerMatch;

  // IRS limits (2026 — update these annually)
  // Placed before hooks that reference them to avoid temporal dead zone errors.
  const IRS_401K_LIMIT = 24500;
  const IRS_401K_CATCHUP = 8000;
  const IRS_401K_SUPER_CATCHUP = 11250;
  const IRS_457B_LIMIT = 24500;
  const IRS_COMP_LIMIT = 360000;
  const IRS_415C_LIMIT = 72000;
  const IRS_IRA_LIMIT = 7500;
  const IRS_IRA_CATCHUP = 1100;
  const IRS_HSA_SELF = 4400;
  const IRS_HSA_FAMILY = 8750;
  const IRS_HSA_CATCHUP = 1000;

  // Calculations
  const standardDeductions = useMemo(() => {
    if (filingStatus === 'Single') return 16100;
    if (filingStatus === 'MFJ') return 32200;
    if (filingStatus === 'MFS') return 16100;
    if (filingStatus === 'HOH') return 24150;
    return 32200;
  }, [filingStatus]);

  const deduction = useStandardDeduction ? standardDeductions : itemizedDeduction;

  // Clamp contribution limits when age/coverage changes
  const hsaMax = useMemo(() => {
    const base = hsaCoverage === 'family' ? IRS_HSA_FAMILY : IRS_HSA_SELF;
    return base + (currentAge >= 55 ? IRS_HSA_CATCHUP : 0);
  }, [hsaCoverage, currentAge]);

  const iraMax = useMemo(() => IRS_IRA_LIMIT + (currentAge >= 50 ? IRS_IRA_CATCHUP : 0), [currentAge]);

  useEffect(() => {
    if (hsaContribution > hsaMax) setHsaContribution(hsaMax);
  }, [hsaMax]);

  useEffect(() => {
    if (traditionalIraContrib > iraMax) setTraditionalIraContrib(iraMax);
    if (rothIraContrib > iraMax) setRothIraContrib(iraMax);
    if (spouseTraditionalIra > iraMax) setSpouseTraditionalIra(iraMax);
    if (spouseRothIra > iraMax) setSpouseRothIra(iraMax);
  }, [iraMax]);

  // Calculate blended return
  const blendedReturn = useMemo(() => {
    const bondReturn = 0.045;
    const equityReturn = 0.07;
    return (equityAllocation / 100) * equityReturn + ((100 - equityAllocation) / 100) * bondReturn;
  }, [equityAllocation]);

  // Tax calculation
  const calculateFederalTax = useCallback((taxableIncome, status) => {
    if (taxableIncome <= 0) return 0;

    const brackets = {
      Single: [
        { limit: 12400, rate: 0.1 },
        { limit: 50400, rate: 0.12 },
        { limit: 105700, rate: 0.22 },
        { limit: 201775, rate: 0.24 },
        { limit: 256225, rate: 0.32 },
        { limit: 640600, rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
      ],
      MFJ: [
        { limit: 24800, rate: 0.1 },
        { limit: 100800, rate: 0.12 },
        { limit: 211400, rate: 0.22 },
        { limit: 403550, rate: 0.24 },
        { limit: 512450, rate: 0.32 },
        { limit: 768700, rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
      ],
      MFS: [
        { limit: 12400, rate: 0.1 },
        { limit: 50400, rate: 0.12 },
        { limit: 105700, rate: 0.22 },
        { limit: 201775, rate: 0.24 },
        { limit: 256225, rate: 0.32 },
        { limit: 384350, rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
      ],
      HOH: [
        { limit: 17700, rate: 0.1 },
        { limit: 64000, rate: 0.12 },
        { limit: 105700, rate: 0.22 },
        { limit: 201775, rate: 0.24 },
        { limit: 256225, rate: 0.32 },
        { limit: 640600, rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
      ],
    };

    const statusBrackets = brackets[status] || brackets.MFJ;
    let tax = 0;
    let previousLimit = 0;

    for (const bracket of statusBrackets) {
      if (taxableIncome <= previousLimit) break;
      const incomeInBracket = Math.min(taxableIncome, bracket.limit) - previousLimit;
      tax += incomeInBracket * bracket.rate;
      previousLimit = bracket.limit;
    }

    return tax;
  }, []);

  const ncTaxDeduction = useMemo(() => {
    if (filingStatus === 'MFJ' || filingStatus === 'MFS') return 25500;
    return 12750;
  }, [filingStatus]);

  // Net Investment Income Tax (NIIT): 3.8% on the lesser of net investment income
  // or MAGI exceeding threshold. IRC §1411.
  const NIIT_THRESHOLDS = { MFJ: 250000, Single: 200000, MFS: 125000, HOH: 200000 };
  const calculateNiit = useCallback((magi, netInvestmentIncome, status) => {
    const threshold = NIIT_THRESHOLDS[status] || 250000;
    const excess = Math.max(0, magi - threshold);
    return 0.038 * Math.min(netInvestmentIncome, excess);
  }, []);

  // Estimate net investment income from current balances.
  // Taxable brokerage: ~1.5% dividend yield + ~1% realized gains ≈ 2.5%
  // Cash savings: ~3% HYSA interest
  const estimateNetInvestmentIncome = useCallback((taxableBal, savingsBal) => {
    return taxableBal * 0.025 + savingsBal * 0.03;
  }, []);

  // Calculate FICA taxes (per-earner: each person has own SS wage base)
  const calculateFicaTax = useCallback((physicianIncome, spouseInc, status) => {
    const ssWageBase = 184500;

    // Physician FICA
    const physicianSS = Math.min(physicianIncome, ssWageBase) * 0.062;
    const physicianMedicare = physicianIncome * 0.0145;

    // Spouse FICA
    const spouseSS = Math.min(spouseInc, ssWageBase) * 0.062;
    const spouseMedicare = spouseInc * 0.0145;

    // Additional Medicare tax on combined household income over threshold
    const combinedIncome = physicianIncome + spouseInc;
    const medicareThreshold = status === 'MFJ' ? 250000 : 200000;
    const additionalMedicare = Math.max(0, combinedIncome - medicareThreshold) * 0.009;

    return physicianSS + physicianMedicare + spouseSS + spouseMedicare + additionalMedicare;
  }, []);

  // Effective 401(k) deferral — deferrals come from base salary only (not true-up payments)
  const effective401kDeferral = useMemo(() => {
    const rawDeferral = baseSalary * (deferralPercentage / 100);
    let maxDeferral = IRS_401K_LIMIT;
    if (currentAge >= 60 && currentAge <= 63) maxDeferral += IRS_401K_SUPER_CATCHUP;
    else if (currentAge >= 50) maxDeferral += IRS_401K_CATCHUP;
    return Math.min(rawDeferral, maxDeferral);
  }, [baseSalary, deferralPercentage, currentAge]);

  // Effective 457(b) deferral — also from base salary, capped at IRS limit
  const effective457bDeferral = useMemo(() => {
    const rawDeferral = baseSalary * (deferral457bPercentage / 100);
    let maxDeferral = IRS_457B_LIMIT;
    if (currentAge >= 60 && currentAge <= 63) maxDeferral += IRS_401K_SUPER_CATCHUP; // SECURE 2.0 super catch-up applies to gov 457(b) too
    else if (currentAge >= 50) maxDeferral += IRS_401K_CATCHUP; // Same catch-up as 401k for 2026
    return Math.min(rawDeferral, maxDeferral);
  }, [baseSalary, deferral457bPercentage, currentAge]);

  // Employer match calculation (75% of first 4% + 50% of next 2%, on comp capped at 401(a)(17) limit)
  // Match uses the EFFECTIVE deferral rate = actual deferral dollars / matchable compensation
  // When deferrals come only from base salary, the effective rate relative to total comp is lower
  const employerMatch = useMemo(() => {
    const matchableComp = Math.min(totalComp, IRS_COMP_LIMIT);
    // Effective deferral rate for match purposes: actual dollars deferred / matchable comp
    const effectiveDeferralRate = matchableComp > 0 ? effective401kDeferral / matchableComp : 0;
    const matchOnFirst4 = Math.min(effectiveDeferralRate, 0.04) * 0.75 * matchableComp;
    const matchOnNext2 = Math.max(0, Math.min(effectiveDeferralRate - 0.04, 0.02)) * 0.50 * matchableComp;
    return matchOnFirst4 + matchOnNext2;
  }, [effective401kDeferral, totalComp]);

  // Basic contribution (2% of pay, on comp capped at 401(a)(17) limit)
  const basicContribution = useMemo(() => {
    return Math.min(totalComp, IRS_COMP_LIMIT) * 0.02;
  }, [totalComp]);

  // Performance-based contribution (on comp capped at 401(a)(17) limit)
  const performanceContribution = useMemo(() => {
    let rate = 0;
    if (yearsOfService < 10) rate = 0.01;
    else if (yearsOfService < 20) rate = 0.015;
    else rate = 0.02;
    return Math.min(totalComp, IRS_COMP_LIMIT) * rate;
  }, [yearsOfService, totalComp]);

  // Total annual retirement contributions
  const annualContributions = useMemo(() => {
    const deferral401k = effective401kDeferral;
    const pre401k = (deferral401k * preVsRothSplit) / 100;
    const roth401k = deferral401k - pre401k;

    // Spouse employer plan: split by pre-tax/Roth slider
    const spouseEmpPreTax = (effSpouseEmployerDeferral * spousePreTaxSplit) / 100;
    const spouseEmpRoth = effSpouseEmployerDeferral - spouseEmpPreTax;

    // Tax-deductible contributions (actually reduce AGI):
    //   - Pre-tax 401(k) deferrals
    //   - 457(b) deferrals (always pre-tax)
    //   - 401(a) employer (deducted from true-up, pre-tax)
    //   - HSA contributions (triple tax-advantaged)
    //   - Spouse pre-tax employer plan deferrals (reduce spouse's taxable wages)
    // NOT deductible at physician income levels:
    //   - Traditional IRA (covered by workplace plan + income exceeds phase-out)
    //   - Roth anything (by definition after-tax)
    const taxDeductible = pre401k + effective457bDeferral + contribution401a + hsaContribution + spouseEmpPreTax;

    // All employee contributions that leave the paycheck (for cash flow purposes):
    // Spouse employer deferrals come from spouse's paycheck, not physician's, but
    // in MFJ household cash flow they're outflows just the same.
    const totalEmployeeContributions = pre401k + roth401k + effective457bDeferral + contribution401a
      + traditionalIraContrib + rothIraContrib + effSpouseTradIra + effSpouseRothIra + hsaContribution
      + effSpouseEmployerDeferral;

    return {
      pre401k,
      roth401k,
      match: employerMatch,
      basic: basicContribution,
      performance: performanceContribution,
      total457b: effective457bDeferral,
      total401a: contribution401a,
      tradIra: traditionalIraContrib,
      rothIra: rothIraContrib,
      spouseTradIra: effSpouseTradIra,
      spouseRothIra: effSpouseRothIra,
      spouseEmpPreTax,
      spouseEmpRoth,
      spouseEmpMatch: effSpouseEmployerMatch,
      hsa: hsaContribution,
      taxDeductible,                  // reduces AGI
      totalEmployeeContributions,     // reduces take-home cash
    };
  }, [effective401kDeferral, preVsRothSplit, employerMatch, basicContribution, performanceContribution, effective457bDeferral, contribution401a, traditionalIraContrib, rothIraContrib, effSpouseTradIra, effSpouseRothIra, hsaContribution, includeSpouse, effSpouseEmployerDeferral, effSpouseEmployerMatch, spousePreTaxSplit]);

  // Tax calculation with all contributions
  const taxCalculations = useMemo(() => {
    const totalGrossIncome = totalComp + effSpouseIncome;
    // FICA is on gross wages (pre-tax retirement contributions don't reduce FICA)
    const ficaTax = calculateFicaTax(totalComp, effSpouseIncome, filingStatus);

    // AGI: gross income minus tax-deductible contributions only
    //   Deductible: pre-tax 401(k), 457(b), 401(a)
    //   NOT deductible: Traditional IRA (income too high with workplace plan), Roth (by definition)
    const agi = totalGrossIncome - annualContributions.taxDeductible;
    const federalTaxableIncome = Math.max(0, agi - deduction);

    const federalTax = calculateFederalTax(federalTaxableIncome, filingStatus);

    // NC tax: starts from federal AGI, subtracts NC standard deduction
    const ncTaxableIncome = Math.max(0, agi - ncTaxDeduction);
    const ncTax = ncTaxableIncome * 0.0399;

    // NIIT: 3.8% on lesser of net investment income or MAGI above threshold
    const nii = estimateNetInvestmentIncome(taxableBrokerage, savingsBalance);
    const niit = calculateNiit(agi, nii, filingStatus);

    const totalTax = federalTax + ficaTax + ncTax + niit;
    const effectiveTaxRate = totalGrossIncome > 0 ? (totalTax / totalGrossIncome) * 100 : 0;

    // Tax savings: calculate what taxes would be WITHOUT pre-tax contributions, then diff
    const agiWithout = totalGrossIncome;
    const fedTaxableWithout = Math.max(0, agiWithout - deduction);
    const federalTaxWithout = calculateFederalTax(fedTaxableWithout, filingStatus);
    const ncTaxableWithout = Math.max(0, agiWithout - ncTaxDeduction);
    const ncTaxWithout = ncTaxableWithout * 0.0399;
    const niitWithout = calculateNiit(agiWithout, nii, filingStatus);
    const taxSavingsFromPreTax = (federalTaxWithout + ncTaxWithout + niitWithout) - (federalTax + ncTax + niit);

    // Marginal tax savings per $100 of pre-tax deferral (exact, not approximated)
    const agiMinus100 = agi - 100;
    const fedTaxableMinus100 = Math.max(0, agiMinus100 - deduction);
    const fedTaxMinus100 = calculateFederalTax(fedTaxableMinus100, filingStatus);
    const ncTaxableMinus100 = Math.max(0, agiMinus100 - ncTaxDeduction);
    const ncTaxMinus100 = ncTaxableMinus100 * 0.0399;
    const niitMinus100 = calculateNiit(agiMinus100, nii, filingStatus);
    const fedSavingsPer100 = federalTax - fedTaxMinus100;
    const ncSavingsPer100 = ncTax - ncTaxMinus100;
    const niitSavingsPer100 = niit - niitMinus100;
    const taxSavingsPer100 = fedSavingsPer100 + ncSavingsPer100 + niitSavingsPer100;

    return {
      ficaTax,
      federalTax,
      ncTax,
      niit,
      totalTax,
      agi,
      taxableIncome: federalTaxableIncome,
      effectiveTaxRate,
      taxSavingsFromPreTax,
      taxSavingsPer100,
      fedSavingsPer100,
      niitSavingsPer100,
    };
  }, [totalComp, effSpouseIncome, includeSpouse, annualContributions, deduction, filingStatus, calculateFicaTax, calculateFederalTax, ncTaxDeduction, calculateNiit, estimateNetInvestmentIncome, taxableBrokerage, savingsBalance]);

  // Annual savings calculation
  const annualSavings = useMemo(() => {
    // After-tax cash = gross income - all taxes - all employee retirement contributions
    const afterTaxIncome = totalComp + effSpouseIncome - taxCalculations.totalTax - annualContributions.totalEmployeeContributions;
    const annualSpending = monthlySpending * 12;
    const debtPayments = studentLoanPayment * 12 + mortgagePayment * 12 + otherDebtPayment * 12;
    const savings = afterTaxIncome - annualSpending - debtPayments;
    return Math.max(0, savings);
  }, [totalComp, effSpouseIncome, includeSpouse, taxCalculations, annualContributions, monthlySpending, studentLoanPayment, mortgagePayment, otherDebtPayment]);

  // Auto-clamp taxable investment when surplus shrinks below current slider value
  useEffect(() => {
    const maxMonthly = Math.max(0, Math.floor(annualSavings / 12 / 100) * 100);
    if (monthlyTaxableInvestment > maxMonthly) {
      setMonthlyTaxableInvestment(maxMonthly);
    }
  }, [annualSavings]);

  // Net worth projection
  const netWorthProjection = useMemo(() => {
    const data = [];
    const rTaxRate = retirementTaxRate / 100; // Convert to decimal

    // Split 401(k) into pre-tax and Roth components
    // Estimate initial split based on current pre/Roth slider (best available heuristic)
    const initialPreTaxRatio = preVsRothSplit / 100;
    let acc401kPreTax = balance401k * initialPreTaxRatio;
    let acc401kRoth = balance401k * (1 - initialPreTaxRatio);
    let acc457b = balance457b;
    let acc401a = balance401a;
    let tradIra = balanceTraditionalIra;
    let tradIraBasis = balanceTraditionalIra; // Track non-deductible basis (contributions, not growth)
    let rothIra = balanceRothIra;
    let hsa = balanceHsa;
    let spousePreTax = effSpousePreTaxBalance;
    let spouseRoth = effSpouseRothBalance;
    let taxable = taxableBrokerage;
    let savings = savingsBalance;
    let sLoan = studentLoanBalance;
    let mort = mortgageBalance;
    let oDebt = otherDebtBalance;
    let totalPenalties = 0; // Cumulative 10% early withdrawal penalties paid
    let shortfallAge = null; // First age where all accounts exhausted and spending can't be covered

    for (let age = currentAge; age <= 90; age++) {
      const isRetired = age >= retirementAge;

      // Growth on existing balances
      // Tax-advantaged accounts grow at full blended return (no annual tax drag)
      acc401kPreTax *= (1 + blendedReturn);
      acc401kRoth *= (1 + blendedReturn);
      acc457b *= (1 + blendedReturn);
      acc401a *= (1 + blendedReturn);
      tradIra *= (1 + blendedReturn);
      rothIra *= (1 + blendedReturn);
      hsa *= (1 + blendedReturn);
      spousePreTax *= (1 + blendedReturn);
      spouseRoth *= (1 + blendedReturn);
      // Taxable brokerage: annual tax drag from dividends, capital gains distributions, and turnover
      // Typical drag is ~1-1.5% for an actively managed portfolio, ~0.5% for index funds
      // Using 1% as a reasonable default for a blended portfolio
      const taxDrag = 0.01;
      taxable *= (1 + blendedReturn - taxDrag);
      // Cash savings: emergency reserve earning HYSA rate, no additional contributions modeled
      savings *= 1.03; // ~3% HYSA return, grows in all phases but drawn last

      const spouseIsRetired = age >= effSpouseRetirementAge;

      if (!isRetired) {
        // Accumulation phase with year-by-year cash flow modeling
        // Step 1: Determine this year's income based on who's still working
        const yearPhysicianIncome = totalComp;
        const yearSpouseIncome = spouseIsRetired ? 0 : effSpouseIncome;
        const yearGrossIncome = yearPhysicianIncome + yearSpouseIncome;

        // Step 2: Planned contributions (spouse contributions stop when spouse retires)
        const yearSpouseTradIra = spouseIsRetired ? 0 : annualContributions.spouseTradIra;
        const yearSpouseRothIra = spouseIsRetired ? 0 : annualContributions.spouseRothIra;
        const yearSpouseEmpPreTax = spouseIsRetired ? 0 : annualContributions.spouseEmpPreTax;
        const yearSpouseEmpRoth = spouseIsRetired ? 0 : annualContributions.spouseEmpRoth;
        const yearSpouseEmpDeferral = yearSpouseEmpPreTax + yearSpouseEmpRoth;
        const yearSpouseEmpMatch = spouseIsRetired ? 0 : annualContributions.spouseEmpMatch;
        const plannedPreTaxDeductible = annualContributions.pre401k + annualContributions.total457b + annualContributions.total401a + annualContributions.hsa + yearSpouseEmpPreTax;
        const plannedEmployeeContrib = annualContributions.pre401k + annualContributions.roth401k + annualContributions.total457b + annualContributions.total401a + annualContributions.tradIra + annualContributions.rothIra + yearSpouseTradIra + yearSpouseRothIra + annualContributions.hsa + yearSpouseEmpDeferral;
        const employerContrib = annualContributions.match + annualContributions.basic + annualContributions.performance;

        // Step 3: Compute taxes WITHOUT pre-tax deductions first to get true baseline take-home
        const yearFica = calculateFicaTax(yearPhysicianIncome, yearSpouseIncome, filingStatus);
        const yearNii = estimateNetInvestmentIncome(taxable, savings);
        const baselineAgi = yearGrossIncome; // no deductions
        const baselineFedTaxable = Math.max(0, baselineAgi - deduction);
        const baselineFederalTax = calculateFederalTax(baselineFedTaxable, filingStatus);
        const baselineNcTaxable = Math.max(0, baselineAgi - ncTaxDeduction);
        const baselineNcTax = baselineNcTaxable * 0.0399;
        const baselineNiit = calculateNiit(baselineAgi, yearNii, filingStatus);
        const baselineTotalTax = baselineFederalTax + yearFica + baselineNcTax + baselineNiit;

        // Step 4: Check affordability with zero contributions
        const yearSpending = monthlySpending * 12;
        const yearDebtPayments = (sLoan > 0 ? studentLoanPayment * 12 : 0) + (mort > 0 ? mortgagePayment * 12 : 0) + (oDebt > 0 ? otherDebtPayment * 12 : 0);
        const yearMandatoryOutflows = yearSpending + yearDebtPayments;
        const yearTaxableInvestment = monthlyTaxableInvestment * 12;
        const baselineTakeHome = yearGrossIncome - baselineTotalTax;
        const cashAfterMandatory = baselineTakeHome - yearMandatoryOutflows;

        // Step 5: Determine contribution scale — RETIREMENT FIRST priority
        // Retirement plan contributions are funded before any taxable brokerage investing.
        // If retirement can't be fully funded, all available cash goes to retirement
        // and taxable investing is zeroed out entirely.
        let contribScale = 0;
        let effectiveTaxableInvestment = 0; // Only funded from genuine surplus after retirement
        if (cashAfterMandatory > 0) {
          // Pre-tax contributions reduce AGI, lowering taxes.
          // Compute taxes WITH full contributions to get best-case take-home.
          const fullDeductAgi = yearGrossIncome - plannedPreTaxDeductible;
          const fullDeductFedTaxable = Math.max(0, fullDeductAgi - deduction);
          const fullDeductFederalTax = calculateFederalTax(fullDeductFedTaxable, filingStatus);
          const fullDeductNcTaxable = Math.max(0, fullDeductAgi - ncTaxDeduction);
          const fullDeductNcTax = fullDeductNcTaxable * 0.0399;
          const fullDeductNiit = calculateNiit(fullDeductAgi, yearNii, filingStatus);
          const fullDeductTotalTax = fullDeductFederalTax + yearFica + fullDeductNcTax + fullDeductNiit;
          const fullTakeHome = yearGrossIncome - fullDeductTotalTax;
          const cashForContribFull = fullTakeHome - yearMandatoryOutflows;

          if (cashForContribFull >= plannedEmployeeContrib) {
            contribScale = 1; // Fully funded
            // Taxable investing only from surplus AFTER retirement is fully funded
            effectiveTaxableInvestment = Math.min(yearTaxableInvestment, cashForContribFull - plannedEmployeeContrib);
          } else if (cashForContribFull <= 0) {
            contribScale = 0; // Tax savings from contributions don't help enough
            // No surplus — no taxable investing
          } else {
            // Partial: scale proportionally based on available cash vs planned
            contribScale = cashForContribFull / plannedEmployeeContrib;
            // Retirement not fully funded — zero taxable investing
          }
        }

        // Step 6: Compute actual taxes using scaled pre-tax deductions
        const actualPreTaxDeductible = plannedPreTaxDeductible * contribScale;
        const yearAgi = yearGrossIncome - actualPreTaxDeductible;
        const yearFedTaxable = Math.max(0, yearAgi - deduction);
        const yearFederalTax = calculateFederalTax(yearFedTaxable, filingStatus);
        const yearNcTaxable = Math.max(0, yearAgi - ncTaxDeduction);
        const yearNcTax = yearNcTaxable * 0.0399;
        const yearNiit = calculateNiit(yearAgi, yearNii, filingStatus);
        const yearTotalTax = yearFederalTax + yearFica + yearNcTax + yearNiit;
        const yearTakeHome = yearGrossIncome - yearTotalTax;

        // Step 7: Apply scaled contributions to accounts
        const sc = contribScale;
        acc401kPreTax += annualContributions.pre401k * sc + employerContrib; // employer always funds
        acc401kRoth += annualContributions.roth401k * sc;
        acc457b += annualContributions.total457b * sc;
        acc401a += annualContributions.total401a * sc;
        tradIra += (annualContributions.tradIra + yearSpouseTradIra) * sc;
        tradIraBasis += (annualContributions.tradIra + yearSpouseTradIra) * sc;
        rothIra += (annualContributions.rothIra + yearSpouseRothIra) * sc;
        hsa += annualContributions.hsa * sc;
        spousePreTax += yearSpouseEmpPreTax * sc + yearSpouseEmpMatch; // Spouse pre-tax deferrals scale, employer match always funds
        spouseRoth += yearSpouseEmpRoth * sc; // Spouse Roth deferrals scale

        const actualEmployeeContrib = plannedEmployeeContrib * sc;

        // Step 8: Handle remaining cash flow (taxable investing already capped at surplus after retirement)
        const yearCashAfterAll = yearTakeHome - yearMandatoryOutflows - actualEmployeeContrib - effectiveTaxableInvestment;

        if (cashAfterMandatory < 0) {
          // Take-home can't even cover spending + debt — pull from liquid accounts
          const deficit = -cashAfterMandatory;
          const fromSavings = Math.min(savings, deficit);
          savings -= fromSavings;
          let stillShort = deficit - fromSavings;
          if (stillShort > 0) {
            const fromTaxable = Math.min(taxable, stillShort);
            taxable -= fromTaxable;
            stillShort -= fromTaxable;
          }
          if (stillShort > 1) {
            shortfallAge = shortfallAge || age;
          }
        } else if (yearCashAfterAll >= 0) {
          // Surplus: taxable investment funded (already capped at surplus after retirement)
          taxable += effectiveTaxableInvestment;
        } else {
          // Mild deficit from tax approximation: trim remaining taxable, then pull from liquid
          const deficit = -yearCashAfterAll;
          const investmentCut = Math.min(effectiveTaxableInvestment, deficit);
          taxable += effectiveTaxableInvestment - investmentCut;
          const remainingDeficit = deficit - investmentCut;
          if (remainingDeficit > 0) {
            const fromSavings = Math.min(savings, remainingDeficit);
            savings -= fromSavings;
            const stillShort = remainingDeficit - fromSavings;
            if (stillShort > 0) {
              taxable = Math.max(0, taxable - stillShort);
            }
          }
        }

        // Debt reduction (simplified: interest accrues, payments reduce balance)
        sLoan = Math.max(0, sLoan * (1 + studentLoanRate / 100) - studentLoanPayment * 12);
        mort = Math.max(0, mort * (1 + mortgageRate / 100) - mortgagePayment * 12);
        oDebt = Math.max(0, oDebt * (1 + otherDebtRate / 100) - otherDebtPayment * 12);
      } else {
        // Drawdown phase: annual spending inflated at 3%, plus debt service
        let remainingDraw = (monthlySpending * 12) * Math.pow(1.03, age - retirementAge);

        // Debt service in retirement — payments must come from drawn funds
        const yearDebtService =
          (sLoan > 0 ? studentLoanPayment * 12 : 0) +
          (mort > 0 ? mortgagePayment * 12 : 0) +
          (oDebt > 0 ? otherDebtPayment * 12 : 0);
        remainingDraw += yearDebtService;

        // Amortize debts (interest accrues, payments reduce balance)
        sLoan = Math.max(0, sLoan * (1 + studentLoanRate / 100) - studentLoanPayment * 12);
        mort = Math.max(0, mort * (1 + mortgageRate / 100) - mortgagePayment * 12);
        oDebt = Math.max(0, oDebt * (1 + otherDebtRate / 100) - otherDebtPayment * 12);

        // Draw from accounts in priority order.
        // Key rules:
        //   - 457(b): NO 10% penalty after separation from employer, regardless of age
        //   - 401(k), 401(a), Trad IRA: 10% early withdrawal penalty before age 59½
        //   - Roth IRA contributions: penalty-free anytime; earnings penalized before 59½ (simplified: treat as penalty-free)
        //   - Taxable, savings, HSA(medical): no penalty
        // Draw order prioritizes penalty-free sources, then 457(b) as the bridge to 59½
        const earlyWithdrawal = age < 60; // Simplified 59½ check (conservative: uses 60)
        const penaltyRate = earlyWithdrawal ? 0.10 : 0;

        const drawOrder = [
          // 1. Tax-free / already-taxed, never penalized
          { get: () => taxable, set: (v) => { taxable = v; }, preTax: false, penalty: 0, label: 'taxable' },
          // 2. HSA: tax-free for qualified medical (assumed qualified in retirement)
          { get: () => hsa, set: (v) => { hsa = v; }, preTax: false, penalty: 0, label: 'hsa' },
          // 3. 457(b): penalty-FREE after separation — this is the bridge account
          { get: () => acc457b, set: (v) => { acc457b = v; }, preTax: true, penalty: 0, label: '457b' },
          // 4. Roth accounts: contributions penalty-free (simplified: all penalty-free)
          { get: () => acc401kRoth, set: (v) => { acc401kRoth = v; }, preTax: false, penalty: 0, label: 'roth401k' },
          { get: () => rothIra, set: (v) => { rothIra = v; }, preTax: false, penalty: 0, label: 'rothIra' },
          { get: () => spouseRoth, set: (v) => { spouseRoth = v; }, preTax: false, penalty: 0, label: 'spouseRoth' },
          // 5. Pre-tax accounts: 10% penalty before 59½
          { get: () => tradIra, set: (v) => { tradIra = v; }, preTax: 'tradIra', penalty: penaltyRate, label: 'tradIra' },
          { get: () => acc401kPreTax, set: (v) => { acc401kPreTax = v; }, preTax: true, penalty: penaltyRate, label: '401kPreTax' },
          { get: () => acc401a, set: (v) => { acc401a = v; }, preTax: true, penalty: penaltyRate, label: '401a' },
          { get: () => spousePreTax, set: (v) => { spousePreTax = v; }, preTax: true, penalty: penaltyRate, label: 'spousePreTax' },
          // 6. Cash savings — last resort emergency reserve (stays constant unless all else depleted)
          { get: () => savings, set: (v) => { savings = v; }, preTax: false, penalty: 0, label: 'savings' },
        ];

        for (const account of drawOrder) {
          if (remainingDraw <= 0) break;
          const available = account.get();
          if (available <= 0) continue;

          let effectiveTaxRate = 0;
          if (account.preTax === true) {
            effectiveTaxRate = rTaxRate;
          } else if (account.preTax === 'tradIra') {
            const earningsRatio = tradIra > 0 ? Math.max(0, (tradIra - tradIraBasis) / tradIra) : 0;
            effectiveTaxRate = rTaxRate * earningsRatio;
          }

          // Total cost per dollar of spending: taxes + penalty
          const totalRate = effectiveTaxRate + account.penalty;
          const grossUpFactor = totalRate > 0 ? 1 / (1 - Math.min(totalRate, 0.99)) : 1;
          const grossWithdrawal = Math.min(available, remainingDraw * grossUpFactor);
          const penaltyPaid = grossWithdrawal * account.penalty;
          const taxPaid = grossWithdrawal * effectiveTaxRate;
          const netSpending = grossWithdrawal - taxPaid - penaltyPaid;

          account.set(available - grossWithdrawal);
          remainingDraw -= netSpending;
          totalPenalties += penaltyPaid;

          // Update basis tracking for Traditional IRA proportionally
          if (account.preTax === 'tradIra' && tradIra + grossWithdrawal > 0) {
            const basisRatio = tradIraBasis / (tradIra + grossWithdrawal);
            tradIraBasis = Math.max(0, tradIraBasis - grossWithdrawal * basisRatio);
          }
        }

        // Track unfunded shortfall (all accounts exhausted but spending not covered)
        if (remainingDraw > 1) { // > $1 to avoid float noise
          shortfallAge = shortfallAge || age;
        }
      }

      const totalRetirement = acc401kPreTax + acc401kRoth + acc457b + acc401a + tradIra + rothIra + hsa + spousePreTax + spouseRoth;
      const totalAssets = totalRetirement + taxable + savings;
      const totalDebts = sLoan + mort + oDebt;
      const netWorth = totalAssets - totalDebts;

      data.push({
        age,
        netWorth: Math.round(netWorth),
        retirement: Math.round(totalRetirement),
        taxable: Math.round(taxable + savings),
        debt: Math.round(totalDebts),
        isRetired,
        // Per-account balances for detailed chart view
        acc457b: Math.round(acc457b),
        acc401kPreTax: Math.round(acc401kPreTax),
        acc401kRoth: Math.round(acc401kRoth),
        acc401a: Math.round(acc401a),
        accTradIra: Math.round(tradIra),
        accRothIra: Math.round(rothIra),
        accHsa: Math.round(hsa),
        accSpousePreTax: Math.round(spousePreTax),
        accSpouseRoth: Math.round(spouseRoth),
        accTaxable: Math.round(taxable),
        accSavings: Math.round(savings),
        totalPenalties: Math.round(totalPenalties),
        shortfallAge,
      });
    }

    // Attach metadata to the array for easy access
    data.shortfallAge = shortfallAge;
    return data;
  }, [currentAge, retirementAge, effSpouseRetirementAge, blendedReturn, balance401k, balance457b, balance401a, balanceTraditionalIra, balanceRothIra, balanceHsa, effSpousePreTaxBalance, effSpouseRothBalance, taxableBrokerage, savingsBalance, studentLoanBalance, studentLoanRate, studentLoanPayment, mortgageBalance, mortgageRate, mortgagePayment, otherDebtBalance, otherDebtRate, otherDebtPayment, monthlySpending, annualContributions, monthlyTaxableInvestment, retirementTaxRate, preVsRothSplit, totalComp, effSpouseIncome, effSpouseEmployerTotal, filingStatus, deduction, ncTaxDeduction, calculateFederalTax, calculateFicaTax, calculateNiit, estimateNetInvestmentIncome, includeSpouse]);

  // Retirement metrics
  const retirementMetrics = useMemo(() => {
    if (netWorthProjection.length === 0) return {};
    const retirementYearData = netWorthProjection.find((d) => d.age === retirementAge);
    const projectedAtRetirement = retirementYearData ? retirementYearData.netWorth : 0;

    // Project retirement account balances including future contributions (FV of annuity + FV of lump sum)
    const yearsToRetire = Math.max(0, retirementAge - currentAge);
    const r = blendedReturn;

    // Future value of current balances (lump sum compounded)
    const fvCurrentBalances = (balance401k + balance457b + balance401a + balanceTraditionalIra + balanceRothIra + balanceHsa + effSpousePreTaxBalance + effSpouseRothBalance) * Math.pow(1 + r, yearsToRetire);

    // Annual retirement contributions — split primary vs spouse for different timelines
    const annualPrimaryContrib = annualContributions.pre401k + annualContributions.roth401k + annualContributions.match + annualContributions.basic + annualContributions.performance + annualContributions.total457b + annualContributions.total401a + annualContributions.tradIra + annualContributions.rothIra + annualContributions.hsa;
    const annualSpouseContrib = annualContributions.spouseTradIra + annualContributions.spouseRothIra + annualContributions.spouseEmpPreTax + annualContributions.spouseEmpRoth + annualContributions.spouseEmpMatch;
    const annualRetContrib = annualPrimaryContrib + annualSpouseContrib;

    const spouseYearsToRetire = Math.max(0, effSpouseRetirementAge - currentAge);

    // Future value of annual contributions (annuity formula) — separate timelines
    const fvPrimaryContrib = r > 0 ? annualPrimaryContrib * ((Math.pow(1 + r, yearsToRetire) - 1) / r) : annualPrimaryContrib * yearsToRetire;
    const fvSpouseContrib = r > 0 ? annualSpouseContrib * ((Math.pow(1 + r, spouseYearsToRetire) - 1) / r) * Math.pow(1 + r, yearsToRetire - spouseYearsToRetire) : annualSpouseContrib * spouseYearsToRetire;
    const fvContributions = fvPrimaryContrib + fvSpouseContrib;

    const projectedRetirementAccounts = fvCurrentBalances + fvContributions;
    const monthlyIncomeFrom4PercentRule = (projectedRetirementAccounts * 0.04) / 12;

    const totalAnnualContributions = annualRetContrib;

    return {
      projectedNetWorth: projectedAtRetirement,
      monthlyRetirementIncome: monthlyIncomeFrom4PercentRule,
      totalAnnualContributions,
      estimatedTaxSavings: taxCalculations.taxSavingsFromPreTax,
    };
  }, [netWorthProjection, retirementAge, effSpouseRetirementAge, currentAge, balance401k, balance457b, balance401a, balanceTraditionalIra, balanceRothIra, balanceHsa, effSpousePreTaxBalance, effSpouseRothBalance, blendedReturn, annualContributions, effSpouseEmployerTotal, taxCalculations, includeSpouse]);

  // ──────────────────────────── SCENARIO COMPARISON ────────────────────────────
  const handleSaveScenario = useCallback(() => {
    setSavedScenario({
      projection: netWorthProjection.map(d => ({ age: d.age, netWorth: d.netWorth })),
      metrics: {
        projectedNetWorth: retirementMetrics.projectedNetWorth,
        totalAnnualContributions: retirementMetrics.totalAnnualContributions,
        estimatedTaxSavings: retirementMetrics.estimatedTaxSavings,
        monthlyRetirementIncome: retirementMetrics.monthlyRetirementIncome,
      },
    });
  }, [netWorthProjection, retirementMetrics]);

  // Merge saved scenario net worth into chart data for overlay
  const chartData = useMemo(() => {
    if (!savedScenario) return netWorthProjection;
    const scenarioMap = new Map(savedScenario.projection.map(d => [d.age, d.netWorth]));
    return netWorthProjection.map(d => ({
      ...d,
      scenarioA: scenarioMap.get(d.age) ?? null,
    }));
  }, [netWorthProjection, savedScenario]);

  // ──────────────────────────── MONTE CARLO SIMULATION ────────────────────────────
  // Runs N simulations with randomized annual returns drawn from a normal distribution.
  // Uses a seeded PRNG (mulberry32) so results are stable across re-renders with same inputs.
  // Produces percentile bands for net worth at each age plus a success probability.
  const monteCarloData = useMemo(() => {
    const NUM_SIMS = 300;
    const EQUITY_VOL = 0.16;  // Annual equity volatility (~16% historical S&P 500)
    const BOND_VOL = 0.06;    // Annual bond volatility (~6% historical aggregate)
    const eqWeight = equityAllocation / 100;
    const bondWeight = 1 - eqWeight;
    // Portfolio volatility (simplified: corr ≈ 0.1 between stocks and bonds)
    const corr = 0.1;
    const portfolioVol = Math.sqrt(
      (eqWeight * EQUITY_VOL) ** 2 + (bondWeight * BOND_VOL) ** 2 + 2 * eqWeight * bondWeight * corr * EQUITY_VOL * BOND_VOL
    );
    const meanReturn = blendedReturn;

    // Mulberry32 seeded PRNG — deterministic for same seed
    const mulberry32 = (seed) => {
      return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    };

    // Box-Muller transform for normal distribution
    const normalRandom = (rng) => {
      const u1 = rng();
      const u2 = rng();
      return Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2);
    };

    // Seed based on key inputs so it only changes when the scenario changes
    const baseSeed = Math.round(currentAge * 1000 + retirementAge * 100 + equityAllocation + balance401k * 0.001 + monthlySpending);

    const rTaxRate = retirementTaxRate / 100;
    const ages = [];
    for (let a = currentAge; a <= 90; a++) ages.push(a);
    const numYears = ages.length;

    // Collect net worth at each age for all sims
    const allNetWorths = ages.map(() => []);
    let successCount = 0;
    let shortfallAges = []; // ages at which sims hit shortfall

    for (let sim = 0; sim < NUM_SIMS; sim++) {
      const rng = mulberry32(baseSeed + sim * 7919); // Different seed per sim

      // Clone initial state
      const initialPreTaxRatio = preVsRothSplit / 100;
      let acc401kPreTax = balance401k * initialPreTaxRatio;
      let acc401kRoth = balance401k * (1 - initialPreTaxRatio);
      let acc457b = balance457b;
      let acc401a = balance401a;
      let tradIra = balanceTraditionalIra;
      let tradIraBasis = balanceTraditionalIra;
      let rothIra = balanceRothIra;
      let hsa = balanceHsa;
      let spousePreTax = effSpousePreTaxBalance;
      let spouseRoth = effSpouseRothBalance;
      let taxable = taxableBrokerage;
      let sav = savingsBalance;
      let sLoan = studentLoanBalance;
      let mort = mortgageBalance;
      let oDebt = otherDebtBalance;
      let shortfallAge = null;

      for (let yi = 0; yi < numYears; yi++) {
        const age = ages[yi];
        const isRetired = age >= retirementAge;

        // Random annual return for this year
        const yearReturn = meanReturn + portfolioVol * normalRandom(rng);
        // Clamp to avoid extreme blow-ups (> -50% or > +60%)
        const clampedReturn = Math.max(-0.50, Math.min(0.60, yearReturn));

        // Growth — tax-advantaged at full return, taxable with drag
        acc401kPreTax *= (1 + clampedReturn);
        acc401kRoth *= (1 + clampedReturn);
        acc457b *= (1 + clampedReturn);
        acc401a *= (1 + clampedReturn);
        tradIra *= (1 + clampedReturn);
        rothIra *= (1 + clampedReturn);
        hsa *= (1 + clampedReturn);
        spousePreTax *= (1 + clampedReturn);
        spouseRoth *= (1 + clampedReturn);
        const taxDrag = 0.01;
        taxable *= (1 + clampedReturn - taxDrag);
        sav *= 1.03;

        const spouseIsRetired = age >= effSpouseRetirementAge;

        if (!isRetired) {
          // ─── Accumulation phase (same logic as deterministic, but with random return) ───
          const yearPhysicianIncome = totalComp;
          const yearSpouseIncome = spouseIsRetired ? 0 : effSpouseIncome;
          const yearGrossIncome = yearPhysicianIncome + yearSpouseIncome;

          const yearSpouseTradIra = spouseIsRetired ? 0 : annualContributions.spouseTradIra;
          const yearSpouseRothIra = spouseIsRetired ? 0 : annualContributions.spouseRothIra;
          const yearSpouseEmpPreTax = spouseIsRetired ? 0 : annualContributions.spouseEmpPreTax;
          const yearSpouseEmpRoth = spouseIsRetired ? 0 : annualContributions.spouseEmpRoth;
          const yearSpouseEmpDeferral = yearSpouseEmpPreTax + yearSpouseEmpRoth;
          const yearSpouseEmpMatch = spouseIsRetired ? 0 : annualContributions.spouseEmpMatch;
          const plannedPreTaxDeductible = annualContributions.pre401k + annualContributions.total457b + annualContributions.total401a + annualContributions.hsa + yearSpouseEmpPreTax;
          const plannedEmployeeContrib = annualContributions.pre401k + annualContributions.roth401k + annualContributions.total457b + annualContributions.total401a + annualContributions.tradIra + annualContributions.rothIra + yearSpouseTradIra + yearSpouseRothIra + annualContributions.hsa + yearSpouseEmpDeferral;
          const employerContrib = annualContributions.match + annualContributions.basic + annualContributions.performance;

          const yearFica = calculateFicaTax(yearPhysicianIncome, yearSpouseIncome, filingStatus);
          const mcNii = estimateNetInvestmentIncome(taxable, sav);
          const baselineAgi = yearGrossIncome;
          const baselineFedTaxable = Math.max(0, baselineAgi - deduction);
          const baselineFederalTax = calculateFederalTax(baselineFedTaxable, filingStatus);
          const baselineNcTaxable = Math.max(0, baselineAgi - ncTaxDeduction);
          const baselineNcTax = baselineNcTaxable * 0.0399;
          const baselineNiit = calculateNiit(baselineAgi, mcNii, filingStatus);
          const baselineTotalTax = baselineFederalTax + yearFica + baselineNcTax + baselineNiit;

          const yearSpending = monthlySpending * 12;
          const yearDebtPayments = (sLoan > 0 ? studentLoanPayment * 12 : 0) + (mort > 0 ? mortgagePayment * 12 : 0) + (oDebt > 0 ? otherDebtPayment * 12 : 0);
          const yearMandatoryOutflows = yearSpending + yearDebtPayments;
          const yearTaxableInvestment = monthlyTaxableInvestment * 12;
          const baselineTakeHome = yearGrossIncome - baselineTotalTax;
          const cashAfterMandatory = baselineTakeHome - yearMandatoryOutflows;

          // Retirement-first priority (mirrors deterministic engine)
          let contribScale = 0;
          let effectiveTaxableInvestment = 0;
          if (cashAfterMandatory > 0) {
            const fullDeductAgi = yearGrossIncome - plannedPreTaxDeductible;
            const fullDeductFedTaxable = Math.max(0, fullDeductAgi - deduction);
            const fullDeductFederalTax = calculateFederalTax(fullDeductFedTaxable, filingStatus);
            const fullDeductNcTaxable = Math.max(0, fullDeductAgi - ncTaxDeduction);
            const fullDeductNcTax = fullDeductNcTaxable * 0.0399;
            const fullDeductNiit = calculateNiit(fullDeductAgi, mcNii, filingStatus);
            const fullDeductTotalTax = fullDeductFederalTax + yearFica + fullDeductNcTax + fullDeductNiit;
            const fullTakeHome = yearGrossIncome - fullDeductTotalTax;
            const cashForContribFull = fullTakeHome - yearMandatoryOutflows;

            if (cashForContribFull >= plannedEmployeeContrib) {
              contribScale = 1;
              effectiveTaxableInvestment = Math.min(yearTaxableInvestment, cashForContribFull - plannedEmployeeContrib);
            } else if (cashForContribFull <= 0) {
              contribScale = 0;
            } else {
              contribScale = cashForContribFull / plannedEmployeeContrib;
            }
          }

          const sc = contribScale;
          acc401kPreTax += annualContributions.pre401k * sc + employerContrib;
          acc401kRoth += annualContributions.roth401k * sc;
          acc457b += annualContributions.total457b * sc;
          acc401a += annualContributions.total401a * sc;
          tradIra += (annualContributions.tradIra + yearSpouseTradIra) * sc;
          tradIraBasis += (annualContributions.tradIra + yearSpouseTradIra) * sc;
          rothIra += (annualContributions.rothIra + yearSpouseRothIra) * sc;
          hsa += annualContributions.hsa * sc;
          spousePreTax += yearSpouseEmpPreTax * sc + yearSpouseEmpMatch;
          spouseRoth += yearSpouseEmpRoth * sc;

          const actualPreTaxDeductible = plannedPreTaxDeductible * sc;
          const yearAgi = yearGrossIncome - actualPreTaxDeductible;
          const yearFedTaxable = Math.max(0, yearAgi - deduction);
          const yearFederalTax = calculateFederalTax(yearFedTaxable, filingStatus);
          const yearNcTaxable = Math.max(0, yearAgi - ncTaxDeduction);
          const yearNcTax = yearNcTaxable * 0.0399;
          const yearNiit = calculateNiit(yearAgi, mcNii, filingStatus);
          const yearTotalTax = yearFederalTax + yearFica + yearNcTax + yearNiit;
          const yearTakeHome = yearGrossIncome - yearTotalTax;
          const actualEmployeeContrib = plannedEmployeeContrib * sc;
          const yearCashAfterAll = yearTakeHome - yearMandatoryOutflows - actualEmployeeContrib - effectiveTaxableInvestment;

          if (cashAfterMandatory < 0) {
            const deficit = -cashAfterMandatory;
            const fromSavings = Math.min(sav, deficit);
            sav -= fromSavings;
            let stillShort = deficit - fromSavings;
            if (stillShort > 0) { const fromTaxable = Math.min(taxable, stillShort); taxable -= fromTaxable; stillShort -= fromTaxable; }
            if (stillShort > 1) shortfallAge = shortfallAge || age;
          } else if (yearCashAfterAll >= 0) {
            taxable += effectiveTaxableInvestment;
          } else {
            const deficit = -yearCashAfterAll;
            const investmentCut = Math.min(effectiveTaxableInvestment, deficit);
            taxable += effectiveTaxableInvestment - investmentCut;
            const remainingDeficit = deficit - investmentCut;
            if (remainingDeficit > 0) {
              const fromSav = Math.min(sav, remainingDeficit);
              sav -= fromSav;
              if (remainingDeficit - fromSav > 0) taxable = Math.max(0, taxable - (remainingDeficit - fromSav));
            }
          }

          sLoan = Math.max(0, sLoan * (1 + studentLoanRate / 100) - studentLoanPayment * 12);
          mort = Math.max(0, mort * (1 + mortgageRate / 100) - mortgagePayment * 12);
          oDebt = Math.max(0, oDebt * (1 + otherDebtRate / 100) - otherDebtPayment * 12);
        } else {
          // ─── Drawdown phase ───
          let remainingDraw = (monthlySpending * 12) * Math.pow(1.03, age - retirementAge);
          const yearDebtService = (sLoan > 0 ? studentLoanPayment * 12 : 0) + (mort > 0 ? mortgagePayment * 12 : 0) + (oDebt > 0 ? otherDebtPayment * 12 : 0);
          remainingDraw += yearDebtService;
          sLoan = Math.max(0, sLoan * (1 + studentLoanRate / 100) - studentLoanPayment * 12);
          mort = Math.max(0, mort * (1 + mortgageRate / 100) - mortgagePayment * 12);
          oDebt = Math.max(0, oDebt * (1 + otherDebtRate / 100) - otherDebtPayment * 12);

          const earlyWithdrawal = age < 60;
          const penaltyRate = earlyWithdrawal ? 0.10 : 0;
          const drawOrder = [
            { get: () => taxable, set: (v) => { taxable = v; }, preTax: false, penalty: 0 },
            { get: () => hsa, set: (v) => { hsa = v; }, preTax: false, penalty: 0 },
            { get: () => acc457b, set: (v) => { acc457b = v; }, preTax: true, penalty: 0 },
            { get: () => acc401kRoth, set: (v) => { acc401kRoth = v; }, preTax: false, penalty: 0 },
            { get: () => rothIra, set: (v) => { rothIra = v; }, preTax: false, penalty: 0 },
            { get: () => spouseRoth, set: (v) => { spouseRoth = v; }, preTax: false, penalty: 0 },
            { get: () => tradIra, set: (v) => { tradIra = v; }, preTax: 'tradIra', penalty: penaltyRate },
            { get: () => acc401kPreTax, set: (v) => { acc401kPreTax = v; }, preTax: true, penalty: penaltyRate },
            { get: () => acc401a, set: (v) => { acc401a = v; }, preTax: true, penalty: penaltyRate },
            { get: () => spousePreTax, set: (v) => { spousePreTax = v; }, preTax: true, penalty: penaltyRate },
            { get: () => sav, set: (v) => { sav = v; }, preTax: false, penalty: 0 },
          ];

          for (const account of drawOrder) {
            if (remainingDraw <= 0) break;
            const available = account.get();
            if (available <= 0) continue;
            let effectiveTaxRate = 0;
            if (account.preTax === true) effectiveTaxRate = rTaxRate;
            else if (account.preTax === 'tradIra') {
              const earningsRatio = tradIra > 0 ? Math.max(0, (tradIra - tradIraBasis) / tradIra) : 0;
              effectiveTaxRate = rTaxRate * earningsRatio;
            }
            const totalRate = effectiveTaxRate + account.penalty;
            const grossUpFactor = totalRate > 0 ? 1 / (1 - Math.min(totalRate, 0.99)) : 1;
            const grossWithdrawal = Math.min(available, remainingDraw * grossUpFactor);
            const taxPaid = grossWithdrawal * effectiveTaxRate;
            const penaltyPaid = grossWithdrawal * account.penalty;
            const netSpending = grossWithdrawal - taxPaid - penaltyPaid;
            account.set(available - grossWithdrawal);
            remainingDraw -= netSpending;
            if (account.preTax === 'tradIra' && tradIra + grossWithdrawal > 0) {
              const basisRatio = tradIraBasis / (tradIra + grossWithdrawal);
              tradIraBasis = Math.max(0, tradIraBasis - grossWithdrawal * basisRatio);
            }
          }

          if (remainingDraw > 1) shortfallAge = shortfallAge || age;
        }

        // Ensure no negative balances from floating point
        acc401kPreTax = Math.max(0, acc401kPreTax);
        acc401kRoth = Math.max(0, acc401kRoth);
        acc457b = Math.max(0, acc457b);
        acc401a = Math.max(0, acc401a);
        tradIra = Math.max(0, tradIra);
        rothIra = Math.max(0, rothIra);
        hsa = Math.max(0, hsa);
        spousePreTax = Math.max(0, spousePreTax);
        spouseRoth = Math.max(0, spouseRoth);
        taxable = Math.max(0, taxable);
        sav = Math.max(0, sav);

        const totalRetirement = acc401kPreTax + acc401kRoth + acc457b + acc401a + tradIra + rothIra + hsa + spousePreTax + spouseRoth;
        const totalAssets = totalRetirement + taxable + sav;
        const totalDebts = sLoan + mort + oDebt;
        const netWorth = totalAssets - totalDebts;
        allNetWorths[yi].push(Math.round(netWorth));
      }

      if (!shortfallAge) successCount++;
      else shortfallAges.push(shortfallAge);
    }

    // Compute percentile bands
    const percentile = (arr, p) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = (p / 100) * (sorted.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo];
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };

    const bands = ages.map((age, yi) => ({
      age,
      p10: Math.round(percentile(allNetWorths[yi], 10)),
      p25: Math.round(percentile(allNetWorths[yi], 25)),
      p50: Math.round(percentile(allNetWorths[yi], 50)),
      p75: Math.round(percentile(allNetWorths[yi], 75)),
      p90: Math.round(percentile(allNetWorths[yi], 90)),
      // Also include deterministic baseline for comparison
      deterministic: netWorthProjection[yi] ? netWorthProjection[yi].netWorth : 0,
    }));

    const successRate = (successCount / NUM_SIMS) * 100;
    const medianShortfallAge = shortfallAges.length > 0 ? Math.round(percentile(shortfallAges, 50)) : null;
    const p10ShortfallAge = shortfallAges.length > 0 ? Math.round(percentile(shortfallAges, 10)) : null;

    return {
      bands,
      successRate,
      numSims: NUM_SIMS,
      portfolioVol: portfolioVol * 100, // as percentage for display
      medianShortfallAge,
      p10ShortfallAge,
      failCount: NUM_SIMS - successCount,
    };
  }, [netWorthProjection, currentAge, retirementAge, effSpouseRetirementAge, equityAllocation, blendedReturn,
    balance401k, balance457b, balance401a, balanceTraditionalIra, balanceRothIra, balanceHsa,
    effSpousePreTaxBalance, effSpouseRothBalance, taxableBrokerage, savingsBalance,
    studentLoanBalance, studentLoanRate, studentLoanPayment, mortgageBalance, mortgageRate, mortgagePayment,
    otherDebtBalance, otherDebtRate, otherDebtPayment, monthlySpending, annualContributions,
    monthlyTaxableInvestment, retirementTaxRate, preVsRothSplit, totalComp, effSpouseIncome,
    filingStatus, deduction, ncTaxDeduction, calculateFederalTax, calculateFicaTax, calculateNiit, estimateNetInvestmentIncome, includeSpouse]);

  // Format currency
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Export data to JSON
  const handleExport = useCallback(() => {
    const data = {
      // Settings
      includeSpouse,

      // Income & Compensation
      baseSalary,
      trueUpPayments,
      filingStatus,
      spouseIncome,
      useStandardDeduction,
      itemizedDeduction,

      // Retirement Contributions - 401(k)
      deferralPercentage,
      preVsRothSplit,
      yearsOfService,

      // Retirement Contributions - 457(b)
      deferral457bPercentage,

      // Retirement Contributions - 401(a)
      contribution401a,

      // Retirement Contributions - IRAs
      traditionalIraContrib,
      rothIraContrib,
      spouseTraditionalIra,
      spouseRothIra,
      spouseEmployerDeferral,
      spouseEmployerMatch,
      spousePreTaxSplit,

      // Health Savings Account
      hsaContribution,
      hsaCoverage,

      // Current Account Balances
      balance401k,
      balance457b,
      balance401a,
      balanceTraditionalIra,
      balanceRothIra,
      balanceHsa,
      spousePreTaxBalance,
      spouseRothBalance,
      taxableBrokerage,
      savingsBalance,

      // Household Budget & Debt
      monthlySpending,
      studentLoanBalance,
      studentLoanRate,
      studentLoanPayment,
      mortgageBalance,
      mortgageRate,
      mortgagePayment,
      otherDebtBalance,
      otherDebtRate,
      otherDebtPayment,
      monthlyTaxableInvestment,

      // Other Assets & Settings
      equityAllocation,
      currentAge,
      retirementAge,
      spouseRetirementAge,
      retirementTaxRate,
    };

    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `physician-financial-plan-${new Date().getTime()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [includeSpouse, baseSalary, trueUpPayments, filingStatus, spouseIncome, useStandardDeduction, itemizedDeduction, deferralPercentage, preVsRothSplit, yearsOfService, deferral457bPercentage, contribution401a, traditionalIraContrib, rothIraContrib, spouseTraditionalIra, spouseRothIra, hsaContribution, hsaCoverage, balance401k, balance457b, balance401a, balanceTraditionalIra, balanceRothIra, balanceHsa, spousePreTaxBalance, spouseRothBalance, taxableBrokerage, savingsBalance, monthlySpending, studentLoanBalance, studentLoanRate, studentLoanPayment, mortgageBalance, mortgageRate, mortgagePayment, otherDebtBalance, otherDebtRate, otherDebtPayment, monthlyTaxableInvestment, equityAllocation, currentAge, retirementAge, spouseRetirementAge, retirementTaxRate]);

  // Import data from JSON
  const handleImport = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result);

        // Restore all state values
        if (data.includeSpouse !== undefined) setIncludeSpouse(data.includeSpouse);
        if (data.baseSalary !== undefined) {
          setBaseSalary(data.baseSalary);
          if (data.trueUpPayments !== undefined) setTrueUpPayments(data.trueUpPayments);
        } else if (data.totalComp !== undefined) {
          // Backward compatibility: old exports used single totalComp field
          // Default split: 2/3 base, 1/3 true-up (rough physician average)
          setBaseSalary(Math.round(data.totalComp * 0.67));
          setTrueUpPayments(Math.round(data.totalComp * 0.33));
        }
        if (data.filingStatus !== undefined) setFilingStatus(data.filingStatus);
        if (data.spouseIncome !== undefined) setSpouseIncome(data.spouseIncome);
        if (data.useStandardDeduction !== undefined) setUseStandardDeduction(data.useStandardDeduction);
        if (data.itemizedDeduction !== undefined) setItemizedDeduction(data.itemizedDeduction);

        if (data.deferralPercentage !== undefined) setDeferralPercentage(data.deferralPercentage);
        if (data.preVsRothSplit !== undefined) setPreVsRothSplit(data.preVsRothSplit);
        if (data.yearsOfService !== undefined) setYearsOfService(data.yearsOfService);

        if (data.deferral457bPercentage !== undefined) setDeferral457bPercentage(data.deferral457bPercentage);
        else if (data.contribution457b !== undefined) setDeferral457bPercentage(0); // Backward compat
        if (data.contribution401a !== undefined) setContribution401a(data.contribution401a);

        if (data.traditionalIraContrib !== undefined) setTraditionalIraContrib(data.traditionalIraContrib);
        if (data.rothIraContrib !== undefined) setRothIraContrib(data.rothIraContrib);
        if (data.spouseTraditionalIra !== undefined) setSpouseTraditionalIra(data.spouseTraditionalIra);
        if (data.spouseRothIra !== undefined) setSpouseRothIra(data.spouseRothIra);
        if (data.spouseEmployerDeferral !== undefined) setSpouseEmployerDeferral(data.spouseEmployerDeferral);
        if (data.spouseEmployerMatch !== undefined) setSpouseEmployerMatch(data.spouseEmployerMatch);
        if (data.spousePreTaxSplit !== undefined) setSpousePreTaxSplit(data.spousePreTaxSplit);
        // Legacy: migrate old combined field
        if (data.spouseEmployerContrib !== undefined && data.spouseEmployerDeferral === undefined) {
          setSpouseEmployerDeferral(Math.round(data.spouseEmployerContrib * 0.75));
          setSpouseEmployerMatch(Math.round(data.spouseEmployerContrib * 0.25));
        }

        if (data.hsaContribution !== undefined) setHsaContribution(data.hsaContribution);
        if (data.hsaCoverage !== undefined) setHsaCoverage(data.hsaCoverage);

        if (data.balance401k !== undefined) setBalance401k(data.balance401k);
        if (data.balance457b !== undefined) setBalance457b(data.balance457b);
        if (data.balance401a !== undefined) setBalance401a(data.balance401a);
        if (data.balanceTraditionalIra !== undefined) setBalanceTraditionalIra(data.balanceTraditionalIra);
        if (data.balanceRothIra !== undefined) setBalanceRothIra(data.balanceRothIra);
        if (data.balanceHsa !== undefined) setBalanceHsa(data.balanceHsa);
        if (data.spousePreTaxBalance !== undefined) setSpousePreTaxBalance(data.spousePreTaxBalance);
        if (data.spouseRothBalance !== undefined) setSpouseRothBalance(data.spouseRothBalance);
        // Backward compat: old exports had single spouseRetirementBalance — treat as all pre-tax
        if (data.spouseRetirementBalance !== undefined && data.spousePreTaxBalance === undefined) {
          setSpousePreTaxBalance(data.spouseRetirementBalance);
          setSpouseRothBalance(0);
        }
        if (data.taxableBrokerage !== undefined) setTaxableBrokerage(data.taxableBrokerage);
        if (data.savingsBalance !== undefined) {
          // Backward compat: old exports had separate emergencyFund — combine into savings
          const oldEmergency = data.emergencyFund || 0;
          setSavingsBalance(data.savingsBalance + oldEmergency);
        }

        if (data.monthlySpending !== undefined) setMonthlySpending(data.monthlySpending);
        if (data.studentLoanBalance !== undefined) setStudentLoanBalance(data.studentLoanBalance);
        if (data.studentLoanRate !== undefined) setStudentLoanRate(data.studentLoanRate);
        if (data.studentLoanPayment !== undefined) setStudentLoanPayment(data.studentLoanPayment);
        if (data.mortgageBalance !== undefined) setMortgageBalance(data.mortgageBalance);
        if (data.mortgageRate !== undefined) setMortgageRate(data.mortgageRate);
        if (data.mortgagePayment !== undefined) setMortgagePayment(data.mortgagePayment);
        if (data.otherDebtBalance !== undefined) setOtherDebtBalance(data.otherDebtBalance);
        if (data.otherDebtRate !== undefined) setOtherDebtRate(data.otherDebtRate);
        if (data.otherDebtPayment !== undefined) setOtherDebtPayment(data.otherDebtPayment);
        if (data.monthlyTaxableInvestment !== undefined) setMonthlyTaxableInvestment(data.monthlyTaxableInvestment);

        if (data.equityAllocation !== undefined) setEquityAllocation(data.equityAllocation);
        if (data.currentAge !== undefined) setCurrentAge(data.currentAge);
        if (data.retirementAge !== undefined) setRetirementAge(data.retirementAge);
        if (data.spouseRetirementAge !== undefined) setSpouseRetirementAge(data.spouseRetirementAge);
        if (data.retirementTaxRate !== undefined) setRetirementTaxRate(data.retirementTaxRate);
      } catch (error) {
        alert('Error importing file: ' + error.message);
      }
    };
    reader.readAsText(file);
  }, []);

  // The Dashboard tab now shows a detailed tax breakdown and contribution summary
  // (chart + key metrics are always visible below all tabs)
  const renderDashboard = () => (
    <div className="space-y-6 max-w-4xl">
      {/* Tax Breakdown */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Annual Tax Breakdown</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">{includeSpouse ? 'Gross Household Income' : 'Gross Income'}</span>
            <span className="text-sm font-semibold">{formatCurrency(totalComp + effSpouseIncome)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">Tax-Deductible Contributions (401k/457b/401a)</span>
            <span className="text-sm font-semibold text-green-700">-{formatCurrency(annualContributions.taxDeductible)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">Adjusted Gross Income (AGI)</span>
            <span className="text-sm font-semibold">{formatCurrency(taxCalculations.agi)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">Federal Taxable Income</span>
            <span className="text-sm font-semibold">{formatCurrency(taxCalculations.taxableIncome)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">Federal Income Tax</span>
            <span className="text-sm font-semibold text-red-700">{formatCurrency(taxCalculations.federalTax)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">FICA (SS + Medicare)</span>
            <span className="text-sm font-semibold text-red-700">{formatCurrency(taxCalculations.ficaTax)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">NC State Income Tax (3.99%)</span>
            <span className="text-sm font-semibold text-red-700">{formatCurrency(taxCalculations.ncTax)}</span>
          </div>
          {taxCalculations.niit > 0 && (
            <div className="flex justify-between border-b border-gray-100 pb-1">
              <span className="text-sm text-gray-600">Net Investment Income Tax (3.8%)</span>
              <span className="text-sm font-semibold text-red-700">{formatCurrency(taxCalculations.niit)}</span>
            </div>
          )}
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">Total Tax Burden</span>
            <span className="text-sm font-bold text-red-800">{formatCurrency(taxCalculations.totalTax)}</span>
          </div>
          <div className="flex justify-between pt-1">
            <span className="text-sm text-gray-600">Effective Tax Rate</span>
            <span className="text-sm font-bold">{taxCalculations.effectiveTaxRate.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between pt-1">
            <span className="text-sm text-gray-600">Tax Savings from Pre-tax Contributions</span>
            <span className="text-sm font-bold text-green-700">{formatCurrency(taxCalculations.taxSavingsFromPreTax)}</span>
          </div>
        </div>
      </div>

      {/* Contribution Summary */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Annual Contribution Summary</h3>
        <div className="space-y-2">
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">401(k) Employee Deferral (Pre-tax)</span>
            <span className="text-sm font-semibold">{formatCurrency(annualContributions.pre401k)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">401(k) Employee Deferral (Roth)</span>
            <span className="text-sm font-semibold">{formatCurrency(annualContributions.roth401k)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-blue-600">401(k) Employer Match</span>
            <span className="text-sm font-semibold text-blue-700">{formatCurrency(annualContributions.match)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-blue-600">401(k) Basic Contribution (2%)</span>
            <span className="text-sm font-semibold text-blue-700">{formatCurrency(annualContributions.basic)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-blue-600">401(k) Performance-based</span>
            <span className="text-sm font-semibold text-blue-700">{formatCurrency(annualContributions.performance)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">457(b) ADVANTAGE</span>
            <span className="text-sm font-semibold">{formatCurrency(annualContributions.total457b)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-amber-700">401(a) Employer (Deducted from true-up)</span>
            <span className="text-sm font-semibold text-amber-700">{formatCurrency(annualContributions.total401a)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">Traditional IRA{includeSpouse ? ' (You + Spouse)' : ''}</span>
            <span className="text-sm font-semibold">{formatCurrency(annualContributions.tradIra + annualContributions.spouseTradIra)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">Roth IRA{includeSpouse ? ' (You + Spouse)' : ''}</span>
            <span className="text-sm font-semibold">{formatCurrency(annualContributions.rothIra + annualContributions.spouseRothIra)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">HSA Contribution</span>
            <span className="text-sm font-semibold text-green-700">{formatCurrency(annualContributions.hsa)}</span>
          </div>
          {includeSpouse && (
            <div className="flex justify-between border-b border-gray-100 pb-1">
              <span className="text-sm text-gray-600">Spouse Employer Plan</span>
              <span className="text-sm font-semibold">{formatCurrency(annualContributions.spouseEmpPreTax + annualContributions.spouseEmpRoth + annualContributions.spouseEmpMatch)}</span>
            </div>
          )}
          <div className="flex justify-between pt-2 border-t-2 border-gray-300">
            <span className="text-sm font-bold text-gray-800">Total Annual Contributions</span>
            <span className="text-sm font-bold text-gray-800">{formatCurrency(retirementMetrics.totalAnnualContributions || 0)}</span>
          </div>
          <p className="text-xs mt-1"><span className="text-blue-600">Blue = employer-funded (additional to your comp)</span> · <span className="text-amber-700">Amber = automatic, deducted from your true-up payment</span></p>
        </div>
      </div>

      {/* Cash Flow Summary */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Annual Cash Flow</h3>
        <div className="space-y-2">
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">After-tax Take-home (post contributions)</span>
            <span className="text-sm font-semibold">{formatCurrency(totalComp + effSpouseIncome - taxCalculations.totalTax - annualContributions.totalEmployeeContributions)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">Annual Living Expenses</span>
            <span className="text-sm font-semibold text-red-700">-{formatCurrency(monthlySpending * 12)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">Annual Debt Payments</span>
            <span className="text-sm font-semibold text-red-700">-{formatCurrency((studentLoanPayment + mortgagePayment + otherDebtPayment) * 12)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-sm text-gray-600">Taxable Brokerage Investment</span>
            <span className="text-sm font-semibold text-blue-700">-{formatCurrency(Math.min(monthlyTaxableInvestment * 12, annualSavings))}</span>
          </div>
          {monthlyTaxableInvestment * 12 > annualSavings && (
            <p className="text-xs text-amber-600 mt-1">Capped from {formatCurrency(monthlyTaxableInvestment * 12)} — retirement contributions take priority</p>
          )}
          <div className="flex justify-between pt-2 border-t-2 border-gray-300">
            <span className="text-sm font-bold text-gray-800">Unallocated Cash (Lifestyle)</span>
            <span className="text-sm font-bold text-gray-600">{formatCurrency(Math.max(0, annualSavings - monthlyTaxableInvestment * 12))}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderIncomeAndCompensation = () => (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Physician Compensation</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Annual Base Salary</label>
              <InfoTip text="Your annual base salary — the total from your biweekly paychecks over the year (26 pay periods). This is the portion of your compensation that 401(k) and 457(b) deferrals are withheld from. Includes your guaranteed base + any recurring production pay. If you know your biweekly gross, multiply by 26." />
            </div>
            <NumericInput value={baseSalary} onChange={setBaseSalary} prefix="$" />
          </div>
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">True-Up / Incentive Payments</label>
              <InfoTip text="Twice-yearly true-up (incentive) payments based on wRVU production and quality metrics. Most physicians do NOT elect 401(k) deferrals from true-up payments because front-loading contributions early in the year can cause you to max out before year-end and miss employer match in later months. This income is included in total compensation for tax and match-eligibility calculations but 401(k) deferrals are not withheld from it." />
            </div>
            <NumericInput value={trueUpPayments} onChange={setTrueUpPayments} prefix="$" />
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded p-3 mt-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Total Annual Compensation</span>
              <span className="text-sm font-bold text-gray-900">{formatCurrency(totalComp)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Tax Filing Status</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Filing Status</label>
            <select
              value={filingStatus}
              onChange={(e) => setFilingStatus(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="Single">Single</option>
              <option value="MFJ">Married Filing Jointly</option>
              <option value="MFS">Married Filing Separately</option>
              <option value="HOH">Head of Household</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">Spouse / Partner</h3>
          <label className="flex items-center space-x-2 cursor-pointer">
            <span className="text-sm text-gray-600">{includeSpouse ? 'Included' : 'Not included'}</span>
            <div
              className={`relative w-10 h-5 rounded-full transition-colors ${includeSpouse ? 'bg-blue-600' : 'bg-gray-300'}`}
              onClick={() => setIncludeSpouse((v) => !v)}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${includeSpouse ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
          </label>
        </div>
        {includeSpouse && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Spouse Annual Income</label>
              <NumericInput value={spouseIncome} onChange={setSpouseIncome} prefix="$" />
            </div>
          </div>
        )}
        {!includeSpouse && (
          <p className="text-sm text-gray-500">Enable to add spouse/partner income, retirement contributions, and account balances to the model.</p>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Deduction Strategy</h3>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="standardDeduction"
              checked={useStandardDeduction}
              onChange={(e) => setUseStandardDeduction(e.target.checked)}
              className="w-4 h-4 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <label htmlFor="standardDeduction" className="text-sm font-medium text-gray-700">
              Use Standard Deduction ({formatCurrency(standardDeductions)})
            </label>
          </div>

          {!useStandardDeduction && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Itemized Deduction Amount</label>
              <NumericInput value={itemizedDeduction} onChange={setItemizedDeduction} prefix="$" />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderRetirementContributions = () => (
    <div className="space-y-6 max-w-4xl">
      {/* 401(k) Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">401(k) Plan</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Deferral Percentage: {deferralPercentage}%</label>
              <InfoTip text="Percentage of your BASE SALARY to defer into your 401(k). Deferrals are withheld from biweekly paychecks only — not from true-up payments. The IRS limits employee deferrals to $24,500 for 2026 ($32,500 if age 50+, $35,750 if age 60-63). Note: your employer match is calculated on your effective deferral rate relative to total compensation (capped at $360,000), which is lower than your base salary deferral rate when true-up income is excluded." />
            </div>
            <input
              type="range"
              min="0"
              max="75"
              step="1"
              value={deferralPercentage}
              onChange={(e) => setDeferralPercentage(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">Annual Deferral: {formatCurrency(effective401kDeferral)} ({deferralPercentage}% of {formatCurrency(baseSalary)} base){baseSalary * (deferralPercentage / 100) > effective401kDeferral ? ` (capped at IRS limit)` : ''} | Effective rate vs total comp: {totalComp > 0 ? ((effective401kDeferral / Math.min(totalComp, IRS_COMP_LIMIT)) * 100).toFixed(1) : 0}%</p>
            {deferralPercentage > 0 && preVsRothSplit > 0 && (
              <p className="text-xs text-green-700 mt-1 font-medium">Pre-tax savings: ${taxCalculations.taxSavingsPer100.toFixed(2)} per $100 deferred (federal {taxCalculations.fedSavingsPer100.toFixed(0)}% + NC 3.99%{taxCalculations.niitSavingsPer100 > 0 ? ' + NIIT 3.8%' : ''})</p>
            )}
          </div>

          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Pre-tax vs Roth Split: {preVsRothSplit}% Pre-tax</label>
              <InfoTip text="Split your 401(k) deferral between pre-tax and Roth. Pre-tax reduces your taxable income now but is taxed on withdrawal. Roth is taxed now but grows and is withdrawn tax-free. Both count toward the same $24,500 annual limit." />
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={preVsRothSplit}
              onChange={(e) => setPreVsRothSplit(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">Pre-tax: {formatCurrency((effective401kDeferral * preVsRothSplit) / 100)} | Roth: {formatCurrency((effective401kDeferral * (100 - preVsRothSplit)) / 100)}</p>
          </div>

          <div className={`${(() => { const matchableComp = Math.min(totalComp, IRS_COMP_LIMIT); const effRate = matchableComp > 0 ? effective401kDeferral / matchableComp : 0; return effRate < 0.06; })() ? 'bg-red-50 border border-red-300' : 'bg-blue-50 border border-blue-200'} rounded p-4 mt-4`}>
            <p className={`text-sm font-semibold ${(() => { const matchableComp = Math.min(totalComp, IRS_COMP_LIMIT); const effRate = matchableComp > 0 ? effective401kDeferral / matchableComp : 0; return effRate < 0.06; })() ? 'text-red-900' : 'text-blue-900'}`}>Employer Match (Automatic)</p>
            <p className="text-xs text-blue-700 mt-1">75% of first 4% + 50% of next 2% of pay</p>
            <p className="text-sm font-bold text-blue-900 mt-2">{formatCurrency(employerMatch)} annually</p>
            {(() => {
              const matchableComp = Math.min(totalComp, IRS_COMP_LIMIT);
              const effRate = matchableComp > 0 ? effective401kDeferral / matchableComp : 0;
              if (effRate >= 0.06) {
                return <p className="text-xs text-green-700 mt-1 font-medium">Full match captured at 6%+ effective deferral rate</p>;
              }
              const fullMatch = matchableComp * 0.04 * 0.75 + matchableComp * 0.02 * 0.50;
              const leftOnTable = fullMatch - employerMatch;
              const yearsToRetire = Math.max(0, retirementAge - currentAge);
              const r = blendedReturn > 0 ? blendedReturn : 0.07;
              const fvLeftOnTable = leftOnTable * ((Math.pow(1 + r, yearsToRetire) - 1) / r);
              return (
                <div className="mt-2 bg-red-100 border border-red-200 rounded p-2">
                  <p className="text-xs text-red-800 font-bold">You're leaving {formatCurrency(leftOnTable)}/yr of free employer match on the table</p>
                  <p className="text-xs text-red-700 mt-1">Your effective deferral rate is {(effRate * 100).toFixed(1)}% of matchable comp — you need 6% for the full match. Over {yearsToRetire} years, the uncaptured match could grow to ~{formatCurrency(fvLeftOnTable)}.</p>
                </div>
              );
            })()}
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded p-4">
            <p className="text-sm text-gray-900 font-semibold">Basic Contribution (Automatic)</p>
            <p className="text-xs text-gray-700 mt-1">2% of pay, vests after 3 years</p>
            <p className="text-sm font-bold text-gray-900 mt-2">{formatCurrency(basicContribution)} annually</p>
          </div>

          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Years of Service</label>
              <InfoTip text="Your years of service determine the performance-based employer contribution rate: less than 10 years = 1% of pay, 10-19 years = 1.5%, 20+ years = 2%. This contribution is based on system performance targets being met." />
            </div>
            <NumericInput value={yearsOfService} onChange={setYearsOfService} min="0" />
          </div>

          <div className="bg-green-50 border border-green-200 rounded p-4">
            <p className="text-sm text-green-900 font-semibold">Performance-based Contribution</p>
            <p className="text-xs text-green-700 mt-1">
              {yearsOfService < 10 && '< 10 years: 1% of pay'}
              {yearsOfService >= 10 && yearsOfService < 20 && '10-19 years: 1.5% of pay'}
              {yearsOfService >= 20 && '20+ years: 2% of pay'}
            </p>
            <p className="text-sm font-bold text-green-900 mt-2">{formatCurrency(performanceContribution)} annually</p>
          </div>
        </div>
      </div>

      {/* 457(b) Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">457(b) ADVANTAGE Account</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Deferral Percentage: {deferral457bPercentage}%</label>
              <InfoTip text="Percentage of your BASE SALARY to defer into your 457(b) ADVANTAGE Account. This is a GOVERNMENTAL 457(b), which has two major advantages over a 401(k): (1) No 10% early withdrawal penalty — you can access funds penalty-free upon separation from your employer at any age, not just after 59½. (2) Assets are protected from loss in the event of employer bankruptcy, unlike non-governmental 457(b) plans. Like 401(k), deferrals are withheld from biweekly paychecks only. The 457(b) has its own separate IRS deferral limit ($24,500 for 2026) that does NOT count against your 401(k) limit — you can defer up to $49,000 total between both plans. No employer match on 457(b). 100% vested immediately." />
            </div>
            <input
              type="range"
              min="0"
              max="75"
              step="1"
              value={deferral457bPercentage}
              onChange={(e) => setDeferral457bPercentage(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">Annual Deferral: {formatCurrency(effective457bDeferral)} ({deferral457bPercentage}% of {formatCurrency(baseSalary)} base){baseSalary * (deferral457bPercentage / 100) > effective457bDeferral ? ' (capped at IRS limit)' : ''}</p>
            {deferral457bPercentage > 0 && (
              <p className="text-xs text-green-700 mt-1 font-medium">Pre-tax savings: ${taxCalculations.taxSavingsPer100.toFixed(2)} per $100 deferred (federal {taxCalculations.fedSavingsPer100.toFixed(0)}% + NC 3.99%{taxCalculations.niitSavingsPer100 > 0 ? ' + NIIT 3.8%' : ''})</p>
            )}
          </div>
        </div>
      </div>

      {/* 401(a) Employer Plan Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">401(a) Employer Plan</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Annual Contribution</label>
              <InfoTip text="The 401(a) contribution is NOT free money — it is deducted from your true-up (incentive) payments. For eligible physicians (prior-year earnings above ~$270k), the contribution is 6% of prior-year earnings, offset against the combined 415(c) annual additions limit ($72,000 for 2026) minus your 401(k) employee + employer contributions. The contribution is automatic and mandatory if your income qualifies — you cannot opt out. Enter your specific amount here." />
            </div>
            <NumericInput value={contribution401a} onChange={setContribution401a} prefix="$" />
            {contribution401a > 0 && (
              <p className="text-xs text-green-700 mt-2 font-medium">Pre-tax savings: ${taxCalculations.taxSavingsPer100.toFixed(2)} per $100 contributed (federal {taxCalculations.fedSavingsPer100.toFixed(0)}% + NC 3.99%{taxCalculations.niitSavingsPer100 > 0 ? ' + NIIT 3.8%' : ''})</p>
            )}
          </div>
        </div>
      </div>

      {/* HSA Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Health Savings Account (HSA)</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Coverage Type</label>
              <InfoTip text="HSA limits depend on your HDHP coverage type. Self-only: $4,400 for 2026. Family: $8,750 for 2026. If you're 55 or older, you can contribute an additional $1,000 catch-up." />
            </div>
            <select
              value={hsaCoverage}
              onChange={(e) => setHsaCoverage(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="self">Self-Only</option>
              <option value="family">Family</option>
            </select>
          </div>
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Annual Contribution: {formatCurrency(hsaContribution)}</label>
              <InfoTip text="HSA contributions are triple tax-advantaged: (1) contributions reduce your AGI (pre-tax), (2) growth is tax-free, (3) withdrawals for qualified medical expenses are tax-free. Unlike retirement accounts, there is no income limit for contributing. Many physicians use HSAs as stealth retirement accounts by paying medical expenses out-of-pocket and letting the HSA grow. After age 65, non-medical withdrawals are taxed as income (like a Traditional IRA) with no penalty." />
            </div>
            <input
              type="range"
              min="0"
              max={hsaCoverage === 'family' ? (currentAge >= 55 ? IRS_HSA_FAMILY + IRS_HSA_CATCHUP : IRS_HSA_FAMILY) : (currentAge >= 55 ? IRS_HSA_SELF + IRS_HSA_CATCHUP : IRS_HSA_SELF)}
              step="50"
              value={hsaContribution}
              onChange={(e) => setHsaContribution(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">2026 Limit: {formatCurrency(hsaCoverage === 'family' ? IRS_HSA_FAMILY : IRS_HSA_SELF)}{currentAge >= 55 ? ` + ${formatCurrency(IRS_HSA_CATCHUP)} catch-up` : ''}</p>
            {hsaContribution > 0 && (
              <p className="text-xs text-green-700 mt-1 font-medium">Pre-tax savings: ${taxCalculations.taxSavingsPer100.toFixed(2)} per $100 contributed (federal {taxCalculations.fedSavingsPer100.toFixed(0)}% + NC 3.99%{taxCalculations.niitSavingsPer100 > 0 ? ' + NIIT 3.8%' : ''})</p>
            )}
          </div>
        </div>
      </div>

      {/* Traditional IRA Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Traditional IRA</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Annual Contribution: {formatCurrency(traditionalIraContrib)}</label>
              <InfoTip text="2026 limit: $7,500 ($8,600 if age 50+). Because you are covered by a workplace retirement plan, Traditional IRA contributions are NOT tax-deductible at physician income levels — this tool does NOT apply a tax deduction for Traditional IRA contributions. The money grows tax-deferred but you will owe income tax on earnings when you withdraw. For most physicians, the backdoor Roth is a better strategy: contribute here (non-deductible), then convert to Roth IRA so earnings grow tax-FREE. Use the Roth IRA slider below if doing a backdoor Roth. Use this slider only if you prefer non-deductible Traditional IRA growth." />
            </div>
            <input
              type="range"
              min="0"
              max={currentAge >= 50 ? (IRS_IRA_LIMIT + IRS_IRA_CATCHUP) : IRS_IRA_LIMIT}
              step="100"
              value={traditionalIraContrib}
              onChange={(e) => setTraditionalIraContrib(Number(e.target.value))}
              className="w-full"
            />
          </div>

        </div>
      </div>

      {/* Roth IRA Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Roth IRA</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Annual Contribution: {formatCurrency(rothIraContrib)}</label>
              <InfoTip text="2026 limit: $7,500 ($8,600 if age 50+). Direct Roth IRA contributions are NOT allowed at physician income levels (phase-out: $150k-$165k single, $236k-$246k MFJ for 2026). Use the 'backdoor Roth' strategy: contribute to a non-deductible Traditional IRA (slider above), then convert to Roth. This slider models the result — contributions here grow tax-FREE and withdrawals are tax-free. Compared to non-deductible Traditional IRA, the advantage is that all growth escapes taxation permanently. The net worth projection applies your estimated retirement tax rate to Traditional IRA earnings but not to Roth, so you can see the real difference. Consult a tax advisor for the conversion mechanics." />
            </div>
            <input
              type="range"
              min="0"
              max={currentAge >= 50 ? (IRS_IRA_LIMIT + IRS_IRA_CATCHUP) : IRS_IRA_LIMIT}
              step="100"
              value={rothIraContrib}
              onChange={(e) => setRothIraContrib(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Spouse Retirement Contributions Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">Spouse Retirement Contributions</h3>
          <label className="flex items-center space-x-2 cursor-pointer">
            <span className="text-sm text-gray-600">{includeSpouse ? 'Included' : 'Not included'}</span>
            <div
              className={`relative w-10 h-5 rounded-full transition-colors ${includeSpouse ? 'bg-blue-600' : 'bg-gray-300'}`}
              onClick={() => setIncludeSpouse((v) => !v)}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${includeSpouse ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
          </label>
        </div>
        {includeSpouse ? (
          <div className="space-y-5">
            {/* Spouse IRA */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Spouse IRA Contributions</h4>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <label className="block text-sm font-medium text-gray-700">Traditional IRA: {formatCurrency(spouseTraditionalIra)}</label>
                    <InfoTip text="Same $7,500 limit ($8,600 at age 50+). A non-working spouse can contribute using a Spousal IRA as long as you file jointly and have enough earned income. At physician household income levels, this contribution is NOT tax-deductible. The money grows tax-deferred but earnings are taxed on withdrawal. For most physician households, the backdoor Roth is a better strategy." />
                  </div>
                  <input type="range" min="0" max={currentAge >= 50 ? (IRS_IRA_LIMIT + IRS_IRA_CATCHUP) : IRS_IRA_LIMIT} step="100" value={spouseTraditionalIra} onChange={(e) => setSpouseTraditionalIra(Number(e.target.value))} className="w-full" />
                </div>
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <label className="block text-sm font-medium text-gray-700">Roth IRA: {formatCurrency(spouseRothIra)}</label>
                    <InfoTip text="Same $7,500 limit ($8,600 at age 50+) and same income restrictions. Backdoor Roth works for spouses too. Combined Traditional + Roth cannot exceed the annual limit per person." />
                  </div>
                  <input type="range" min="0" max={currentAge >= 50 ? (IRS_IRA_LIMIT + IRS_IRA_CATCHUP) : IRS_IRA_LIMIT} step="100" value={spouseRothIra} onChange={(e) => setSpouseRothIra(Number(e.target.value))} className="w-full" />
                </div>
              </div>
            </div>

            {/* Spouse Employer Plan */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Spouse Employer Plan (401k/403b/457b)</h4>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <label className="block text-sm font-medium text-gray-700">Employee Deferrals: {formatCurrency(spouseEmployerDeferral)}/yr</label>
                    <InfoTip text="Spouse's own annual deferrals into their employer retirement plan. If spouse has access to BOTH a 401(k)/403(b) AND a 457(b), combine both deferrals here — each has its own $24,500 limit ($49,000 combined). The 457(b) has a separate IRS limit from the 401(k)/403(b). If spouse only has one plan, use the single-plan limit. Catch-up: add $8,000/plan if age 50+ ($65,000 combined), or $11,250/plan if age 60-63. These deferrals stop when spouse retires." />
                  </div>
                  <input type="range" min="0" max="65000" step="500" value={spouseEmployerDeferral} onChange={(e) => setSpouseEmployerDeferral(Number(e.target.value))} className="w-full" />
                </div>
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <label className="block text-sm font-medium text-gray-700">Pre-Tax vs Roth Split: {spousePreTaxSplit}% Pre-Tax / {100 - spousePreTaxSplit}% Roth</label>
                    <InfoTip text="How spouse employer plan deferrals are split between pre-tax and Roth. Pre-tax reduces current taxable income; Roth grows tax-free. 100% = all pre-tax, 0% = all Roth. Note: starting 2026, catch-up contributions for earners over $150K must be Roth per SECURE 2.0." />
                  </div>
                  <input type="range" min="0" max="100" step="5" value={spousePreTaxSplit} onChange={(e) => setSpousePreTaxSplit(Number(e.target.value))} className="w-full" />
                </div>
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <label className="block text-sm font-medium text-gray-700">Employer Match: {formatCurrency(spouseEmployerMatch)}/yr</label>
                    <InfoTip text="Annual employer match or contribution to spouse's plan. This is FREE money from spouse's employer — always pre-tax, always funds regardless of cash flow constraints. Set to $0 if no employer match." />
                  </div>
                  <input type="range" min="0" max="30000" step="500" value={spouseEmployerMatch} onChange={(e) => setSpouseEmployerMatch(Number(e.target.value))} className="w-full" />
                </div>
                <p className="text-xs text-gray-500">Total going into spouse plan: {formatCurrency(spouseEmployerDeferral + spouseEmployerMatch)}/yr ({formatCurrency(spouseEmployerDeferral * spousePreTaxSplit / 100 + spouseEmployerMatch)} pre-tax, {formatCurrency(spouseEmployerDeferral * (100 - spousePreTaxSplit) / 100)} Roth)</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Enable spouse on the Income tab to model spouse retirement contributions.</p>
        )}
      </div>
    </div>
  );

  const renderHouseholdBudgetAndDebt = () => (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Monthly Spending Estimate</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Monthly Spending: {formatCurrency(monthlySpending)}</label>
            <input
              type="range"
              min="0"
              max="50000"
              step="100"
              value={monthlySpending}
              onChange={(e) => setMonthlySpending(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">Annual: {formatCurrency(monthlySpending * 12)}</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Taxable Brokerage Investment</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Monthly Investment: {formatCurrency(monthlyTaxableInvestment)}</label>
              <InfoTip text="Amount you explicitly invest each month into taxable brokerage accounts (e.g., Vanguard, Fidelity, Schwab). Only this amount grows in the net worth projection — any unallocated cash beyond this is assumed spent on lifestyle. This slider is capped at your available monthly surplus after taxes, retirement contributions, spending, and debt payments." />
            </div>
            {(() => {
              const maxMonthly = Math.max(0, Math.floor(annualSavings / 12 / 100) * 100);
              const sliderMax = Math.max(maxMonthly, 100); // Minimum slider range of $100
              const atCap = monthlyTaxableInvestment >= maxMonthly && maxMonthly > 0;
              const overCap = monthlyTaxableInvestment > maxMonthly;
              return (
                <>
                  <input
                    type="range"
                    min="0"
                    max={sliderMax}
                    step="100"
                    value={Math.min(monthlyTaxableInvestment, sliderMax)}
                    onChange={(e) => setMonthlyTaxableInvestment(Number(e.target.value))}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">Annual: {formatCurrency(monthlyTaxableInvestment * 12)} | Remaining unallocated: {formatCurrency(Math.max(0, annualSavings - monthlyTaxableInvestment * 12))}/yr</p>
                  {overCap && (
                    <p className="text-xs text-amber-600 mt-1 font-medium">Slider adjusted — your available surplus is {formatCurrency(maxMonthly)}/mo after taxes, retirement, spending, and debt.</p>
                  )}
                  {atCap && !overCap && (
                    <p className="text-xs text-blue-600 mt-1 font-medium">You're investing your full available surplus. Any additional cash flow goes to lifestyle.</p>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Student Loans</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Current Balance</label>
            <NumericInput value={studentLoanBalance} onChange={setStudentLoanBalance} prefix="$" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Interest Rate (%)</label>
            <NumericInput value={studentLoanRate} onChange={setStudentLoanRate} step="0.1" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Monthly Payment</label>
            <NumericInput value={studentLoanPayment} onChange={setStudentLoanPayment} prefix="$" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Mortgage</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Current Balance</label>
            <NumericInput value={mortgageBalance} onChange={setMortgageBalance} prefix="$" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Interest Rate (%)</label>
            <NumericInput value={mortgageRate} onChange={setMortgageRate} step="0.1" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Monthly Payment</label>
            <NumericInput value={mortgagePayment} onChange={setMortgagePayment} prefix="$" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Other Debt</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Current Balance</label>
            <NumericInput value={otherDebtBalance} onChange={setOtherDebtBalance} prefix="$" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Interest Rate (%)</label>
            <NumericInput value={otherDebtRate} onChange={setOtherDebtRate} step="0.1" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Monthly Payment</label>
            <NumericInput value={otherDebtPayment} onChange={setOtherDebtPayment} prefix="$" />
          </div>
        </div>
      </div>

    </div>
  );

  const renderOtherAssetsAndSettings = () => (
    <div className="space-y-6 max-w-4xl">
      {/* Current Account Balances */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Current Account Balances</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">401(k) Balance</label>
            <NumericInput value={balance401k} onChange={setBalance401k} prefix="$" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">457(b) Balance</label>
            <NumericInput value={balance457b} onChange={setBalance457b} prefix="$" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">401(a) Balance</label>
            <NumericInput value={balance401a} onChange={setBalance401a} prefix="$" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Traditional IRA Balance</label>
            <NumericInput value={balanceTraditionalIra} onChange={setBalanceTraditionalIra} prefix="$" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Roth IRA Balance</label>
            <NumericInput value={balanceRothIra} onChange={setBalanceRothIra} prefix="$" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">HSA Balance <InfoTip text="Health Savings Account balance (household total). Triple tax advantage: contributions reduce AGI, growth is tax-free, and qualified medical withdrawals are tax-free. In the projection, HSA is drawn after taxable accounts but before pre-tax retirement accounts." /></label>
            <NumericInput value={balanceHsa} onChange={setBalanceHsa} prefix="$" />
          </div>

          {includeSpouse && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Spouse Pre-Tax Retirement <InfoTip text="Spouse's combined pre-tax retirement accounts: 401(k), 457(b), 403(b), and any other traditional/pre-tax accounts. These will be taxed as ordinary income on withdrawal." /></label>
              <NumericInput value={spousePreTaxBalance} onChange={setSpousePreTaxBalance} prefix="$" />
            </div>
          )}

          {includeSpouse && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Spouse Roth Balance <InfoTip text="Spouse's Roth IRA and any Roth 401(k)/403(b) balances. Tax-free on qualified withdrawal — these are drawn last in the projection to maximize tax-free growth." /></label>
              <NumericInput value={spouseRothBalance} onChange={setSpouseRothBalance} prefix="$" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Taxable Brokerage Balance</label>
            <NumericInput value={taxableBrokerage} onChange={setTaxableBrokerage} prefix="$" />
          </div>

          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Cash Savings (Checking, Savings, Emergency Fund)</label>
              <InfoTip text="Total cash across all savings, checking, HYSA, and emergency fund accounts. This grows at ~4% in the projection (HYSA rate) and is drawn from during retirement after taxable brokerage is depleted." />
            </div>
            <NumericInput value={savingsBalance} onChange={setSavingsBalance} prefix="$" />
          </div>
        </div>
      </div>

      {/* Investment Allocation */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Investment Allocation & Returns</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Equity Allocation: {equityAllocation}%</label>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={equityAllocation}
              onChange={(e) => setEquityAllocation(Number(e.target.value))}
              className="w-full"
            />
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <p className="text-xs text-gray-600">Bonds</p>
                <p className="text-sm font-bold text-gray-900">{100 - equityAllocation}%</p>
                <p className="text-xs text-gray-600">@ 4.5%</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded p-3">
                <p className="text-xs text-blue-600">Equities</p>
                <p className="text-sm font-bold text-blue-900">{equityAllocation}%</p>
                <p className="text-xs text-blue-600">@ 7%</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded p-3">
                <p className="text-xs text-green-600">Blended</p>
                <p className="text-sm font-bold text-green-900">{(blendedReturn * 100).toFixed(2)}%</p>
                <p className="text-xs text-green-600">avg return</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Retirement Withdrawal Tax Assumption */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Retirement Withdrawal Tax Rate</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Estimated Effective Tax Rate in Retirement: {retirementTaxRate}%</label>
              <InfoTip text="This is your estimated combined effective tax rate (federal + state) on withdrawals from pre-tax accounts in retirement (401k pre-tax, 457b, 401a). Roth withdrawals are tax-free and not affected by this rate. Traditional IRA withdrawals are partially taxed (only the earnings portion, since your contributions were non-deductible). This rate directly affects how long your pre-tax accounts last — higher tax = more withdrawn per dollar of spending. Typical range for retirees: 15-25%. Adjust based on your expected retirement income level and state of residence." />
            </div>
            <input
              type="range"
              min="0"
              max="40"
              step="1"
              value={retirementTaxRate}
              onChange={(e) => setRetirementTaxRate(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0% (no tax)</span>
              <span>22% (typical)</span>
              <span>40% (high bracket)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Personal Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Personal Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Current Age</label>
            <NumericInput value={currentAge} onChange={setCurrentAge} min="20" max="100" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Your Retirement Age <InfoTip text="The age at which your income stops, your contributions end, and the drawdown phase begins. This controls when the projection switches from accumulation to spending down accounts." /></label>
            <NumericInput value={retirementAge} onChange={setRetirementAge} min="50" max="100" />
          </div>

          {includeSpouse && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Spouse Retirement Age <InfoTip text="The age at which your spouse stops working. All spouse retirement contributions (IRA + employer plan deferrals) stop at this age. Spouse income also stops. If earlier than your retirement, the model enters a single-income phase." /></label>
              <NumericInput value={spouseRetirementAge} onChange={setSpouseRetirementAge} min="50" max="100" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Years of Service</label>
            <NumericInput value={yearsOfService} onChange={setYearsOfService} min="0" />
          </div>
        </div>
      </div>

      {/* Save/Load Data */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Save & Load Your Plan</h3>
        <div className="space-y-4">
          <button
            onClick={handleExport}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center space-x-2 transition"
          >
            <Download className="w-5 h-5" />
            <span>Download My Data (JSON)</span>
          </button>

          <div className="relative">
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition">
              <Upload className="w-5 h-5 mx-auto text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-700">Load My Data (JSON)</p>
              <p className="text-xs text-gray-500 mt-1">Click to select a previously saved plan</p>
            </div>
          </div>
        </div>
      </div>

      {/* IRS Limits Reference */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">2026 IRS Contribution Limits</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">401(k) Deferral:</span>
              <span className="font-semibold text-gray-900">$24,500</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">401(k) Catch-up (50+):</span>
              <span className="font-semibold text-gray-900">$8,000</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">401(k) Super Catch-up (60-63):</span>
              <span className="font-semibold text-gray-900">$11,250</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">457(b) Deferral:</span>
              <span className="font-semibold text-gray-900">$24,500</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">457(b) Catch-up (50+):</span>
              <span className="font-semibold text-gray-900">$8,000</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">IRA Contribution:</span>
              <span className="font-semibold text-gray-900">$7,500</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">IRA Catch-up (50+):</span>
              <span className="font-semibold text-gray-900">$1,100</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">HSA (Self):</span>
              <span className="font-semibold text-gray-900">$4,400</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">HSA (Family):</span>
              <span className="font-semibold text-gray-900">$8,750</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">415(c) Annual Additions:</span>
              <span className="font-semibold text-gray-900">$72,000</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">SS Wage Base:</span>
              <span className="font-semibold text-gray-900">$184,500</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-700">Comp Limit (IRC 401(a)(17)):</span>
              <span className="font-semibold text-gray-900">$360,000</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ──────────────────────────── RETIREMENT TIMELINE TAB ────────────────────────────
  const renderRetirementTimeline = () => {
    if (netWorthProjection.length === 0) return <p className="text-gray-500">No projection data available.</p>;

    // ── Phase detection ──
    // Build phases from user inputs: both working, single income, early retirement (pre-59½), 59½ milestone, full retirement
    const phases = [];
    const spouseRetiresBefore = includeSpouse && effSpouseRetirementAge < retirementAge;
    const retiresBefore59 = retirementAge < 60; // conservative 59½ check
    const age59Point5 = 60; // simplified

    // Phase 1: Both working (or single working if no spouse)
    const phase1End = spouseRetiresBefore ? effSpouseRetirementAge - 1 : retirementAge - 1;
    if (currentAge <= phase1End) {
      phases.push({
        label: includeSpouse ? 'Both Working' : 'Working',
        startAge: currentAge,
        endAge: phase1End,
        color: 'bg-emerald-100 border-emerald-400 text-emerald-900',
        dotColor: 'bg-emerald-500',
        income: includeSpouse ? ['Physician salary', 'Spouse income'] : ['Physician salary'],
        accounts: 'All accounts receiving contributions',
        penaltyStatus: 'N/A — accumulation phase',
        cashFlowNote: 'Surplus goes to lifestyle / taxable investing',
      });
    }

    // Phase 2: Single income (only if spouse retires before physician)
    if (spouseRetiresBefore) {
      phases.push({
        label: 'Single Income',
        startAge: effSpouseRetirementAge,
        endAge: retirementAge - 1,
        color: 'bg-amber-100 border-amber-400 text-amber-900',
        dotColor: 'bg-amber-500',
        income: ['Physician salary only'],
        accounts: 'Primary accounts only — spouse contributions stopped',
        penaltyStatus: 'N/A — accumulation phase',
        cashFlowNote: 'Reduced household income; watch for cash flow deficit',
      });
    }

    // Phase 3: Early retirement / pre-59½ (if retiring before 59½)
    if (retiresBefore59) {
      phases.push({
        label: 'Early Retirement',
        startAge: retirementAge,
        endAge: age59Point5 - 1,
        color: 'bg-orange-100 border-orange-400 text-orange-900',
        dotColor: 'bg-orange-500',
        income: ['No earned income — drawing from accounts'],
        accounts: '457(b) is the bridge: penalty-free after separation',
        penaltyStatus: '10% penalty on 401(k)/401(a)/Trad IRA withdrawals',
        cashFlowNote: 'Draw order: Taxable → HSA → 457(b) → Roth → penalized pre-tax → Cash savings (last resort)',
        highlight: true,
      });
    }

    // Phase 4: 59½ milestone (only meaningful if physician retired before 59½)
    if (retiresBefore59) {
      phases.push({
        label: '59½ — Penalty-Free',
        startAge: age59Point5,
        endAge: 90,
        color: 'bg-blue-100 border-blue-400 text-blue-900',
        dotColor: 'bg-blue-500',
        income: ['No earned income — all accounts accessible'],
        accounts: 'All accounts now penalty-free',
        penaltyStatus: 'No penalties on any account',
        cashFlowNote: 'Draw order: Taxable → HSA → 457(b)/pre-tax → Roth → Cash savings (last resort)',
      });
    } else {
      // Retiring at/after 59½ — single retirement phase
      phases.push({
        label: 'Retirement',
        startAge: retirementAge,
        endAge: 90,
        color: 'bg-blue-100 border-blue-400 text-blue-900',
        dotColor: 'bg-blue-500',
        income: ['No earned income — drawing from accounts'],
        accounts: 'All accounts accessible, penalty-free (age ≥ 59½)',
        penaltyStatus: 'No penalties',
        cashFlowNote: 'Draw order: Taxable → HSA → 457(b) → Roth → Pre-tax → Cash savings (last resort)',
      });
    }

    // ── Compute per-phase stats from projection data ──
    const phaseStats = phases.map((phase) => {
      const phaseData = netWorthProjection.filter((d) => d.age >= phase.startAge && d.age <= phase.endAge);
      const startData = phaseData[0];
      const endData = phaseData[phaseData.length - 1];
      const startNW = startData ? startData.netWorth : 0;
      const endNW = endData ? endData.netWorth : 0;
      const penaltiesInPhase = phaseData.length > 1
        ? (endData?.totalPenalties || 0) - (startData?.totalPenalties || 0)
        : 0;
      // Check which accounts depleted during this phase
      const depleted = [];
      if (startData && endData) {
        if (startData.acc457b > 0 && endData.acc457b === 0) depleted.push('457(b)');
        if (startData.accTaxable > 0 && endData.accTaxable === 0) depleted.push('Taxable');
        if (startData.accSavings > 0 && endData.accSavings === 0) depleted.push('Savings');
        if (startData.accHsa > 0 && endData.accHsa === 0) depleted.push('HSA');
        if (startData.acc401kPreTax > 0 && endData.acc401kPreTax === 0) depleted.push('401(k) Pre-Tax');
        if (startData.acc401kRoth > 0 && endData.acc401kRoth === 0) depleted.push('401(k) Roth');
        if (startData.accRothIra > 0 && endData.accRothIra === 0) depleted.push('Roth IRA');
        if (includeSpouse && startData.accSpousePreTax > 0 && endData.accSpousePreTax === 0) depleted.push('Spouse Pre-Tax');
      }
      return { ...phase, startNW, endNW, nwChange: endNW - startNW, penaltiesInPhase, depleted, years: phase.endAge - phase.startAge + 1 };
    });

    // Total penalties across all phases
    const lastProjection = netWorthProjection[netWorthProjection.length - 1];
    const totalLifetimePenalties = lastProjection ? lastProjection.totalPenalties : 0;

    return (
      <div className="space-y-6">
        {/* ── Horizontal Phase Diagram ── */}
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-3">Retirement Phase Timeline</h3>
          <div className="flex items-stretch gap-0 rounded-xl overflow-hidden border border-gray-200">
            {phaseStats.map((phase, idx) => {
              const totalYears = 90 - currentAge + 1;
              const widthPct = Math.max(8, (phase.years / totalYears) * 100); // min 8% so narrow phases are visible
              return (
                <div
                  key={idx}
                  className={`relative border-l-4 ${phase.color} px-3 py-3 flex flex-col justify-between`}
                  style={{ width: `${widthPct}%`, minWidth: '80px' }}
                >
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide mb-0.5">{phase.label}</div>
                    <div className="text-xs opacity-75">Age {phase.startAge}–{phase.endAge} ({phase.years}yr)</div>
                  </div>
                  {phase.highlight && (
                    <div className="mt-1 text-xs font-semibold bg-orange-200 rounded px-1.5 py-0.5 inline-block">457(b) Bridge</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Phase Detail Cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {phaseStats.map((phase, idx) => (
            <div key={idx} className={`rounded-lg border-2 p-4 ${phase.color}`}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-base">{phase.label}</h4>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white bg-opacity-60">
                  Age {phase.startAge}–{phase.endAge}
                </span>
              </div>

              <div className="space-y-1.5 text-sm">
                <div>
                  <span className="font-semibold">Income: </span>
                  {phase.income.join(', ')}
                </div>
                <div>
                  <span className="font-semibold">Accounts: </span>
                  {phase.accounts}
                </div>
                <div>
                  <span className="font-semibold">Penalty Status: </span>
                  {phase.penaltyStatus}
                </div>
                <div>
                  <span className="font-semibold">Strategy: </span>
                  {phase.cashFlowNote}
                </div>
              </div>

              <div className="mt-3 pt-2 border-t border-current border-opacity-20 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="block text-opacity-70 font-medium">Start Net Worth</span>
                  <span className="font-bold text-sm">{formatCurrency(phase.startNW)}</span>
                </div>
                <div>
                  <span className="block text-opacity-70 font-medium">End Net Worth</span>
                  <span className="font-bold text-sm">{formatCurrency(phase.endNW)}</span>
                </div>
                {phase.penaltiesInPhase > 0 && (
                  <div className="col-span-2">
                    <span className="block text-opacity-70 font-medium">Penalties Paid This Phase</span>
                    <span className="font-bold text-sm text-red-700">{formatCurrency(phase.penaltiesInPhase)}</span>
                  </div>
                )}
                {phase.depleted.length > 0 && (
                  <div className="col-span-2">
                    <span className="block text-opacity-70 font-medium">Accounts Depleted</span>
                    <span className="font-bold text-sm">{phase.depleted.join(', ')}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Insolvency Warning ── */}
        {netWorthProjection.shortfallAge && (
          <div className="bg-red-100 border-2 border-red-400 rounded-lg p-4 flex items-center justify-between">
            <div>
              <span className="font-bold text-red-900">Funding Shortfall Detected</span>
              <p className="text-sm text-red-700 mt-0.5">
                {netWorthProjection.shortfallAge < retirementAge
                  ? <>At <strong>age {netWorthProjection.shortfallAge}</strong> (before retirement), spending and debt payments exceed take-home pay and all liquid accounts are depleted. Retirement contributions have been scaled to zero. Reduce monthly spending or increase income to close the gap.</>
                  : <>All accounts are projected to be exhausted at <strong>age {netWorthProjection.shortfallAge}</strong>. Beyond this point, spending and debt service exceed available assets. Consider reducing spending, delaying retirement, or increasing contributions.</>
                }
              </p>
            </div>
            <span className="text-2xl font-bold text-red-700">Age {netWorthProjection.shortfallAge}</span>
          </div>
        )}

        {/* ── Lifetime Penalty Summary ── */}
        {totalLifetimePenalties > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
            <div>
              <span className="font-bold text-red-800">Total Lifetime Early Withdrawal Penalties</span>
              <p className="text-xs text-red-600 mt-0.5">10% penalty on 401(k)/401(a)/Trad IRA withdrawals before age 59½. 457(b) is exempt.</p>
            </div>
            <span className="text-xl font-bold text-red-700">{formatCurrency(totalLifetimePenalties)}</span>
          </div>
        )}

        {/* ── Large Stacked Area Chart with Phase Boundaries ── */}
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Account Balances by Phase</h3>
          <div style={{ height: 450 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={netWorthProjection} margin={{ top: 10, right: 25, left: 0, bottom: 0 }} stackOffset="none">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="age" tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis
                  tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  width={55}
                />
                <Tooltip content={<StackedTooltip />} />
                <Legend wrapperStyle={{ fontSize: '10px' }} />

                {/* Phase boundary reference lines */}
                {phaseStats.map((phase, idx) => {
                  if (idx === 0) return null; // No line for the start of the first phase
                  return (
                    <ReferenceLine
                      key={`phase-${idx}`}
                      x={phase.startAge}
                      stroke="#374151"
                      strokeDasharray="4 3"
                      strokeWidth={1.5}
                      label={{ value: phase.label, position: 'top', fontSize: 9, fill: '#374151', fontWeight: 600 }}
                    />
                  );
                })}

                {/* 59½ marker if not already a phase boundary */}
                {!retiresBefore59 && currentAge < 60 && (
                  <ReferenceLine x={60} stroke="#f59e0b" strokeDasharray="4 2" strokeWidth={1} label={{ value: '59½', position: 'top', fontSize: 10, fill: '#f59e0b' }} />
                )}

                {/* Stacked areas — same order as main chart */}
                <Area type="monotone" dataKey="acc457b" stackId="1" stroke="#059669" fill="#059669" fillOpacity={0.85} name="457(b)" />
                <Area type="monotone" dataKey="acc401kPreTax" stackId="1" stroke="#2563eb" fill="#2563eb" fillOpacity={0.7} name="401(k) Pre-Tax" />
                <Area type="monotone" dataKey="acc401kRoth" stackId="1" stroke="#7c3aed" fill="#7c3aed" fillOpacity={0.7} name="401(k) Roth" />
                <Area type="monotone" dataKey="acc401a" stackId="1" stroke="#0891b2" fill="#0891b2" fillOpacity={0.7} name="401(a)" />
                <Area type="monotone" dataKey="accTradIra" stackId="1" stroke="#d97706" fill="#d97706" fillOpacity={0.7} name="Traditional IRA" />
                <Area type="monotone" dataKey="accRothIra" stackId="1" stroke="#c026d3" fill="#c026d3" fillOpacity={0.7} name="Roth IRA" />
                <Area type="monotone" dataKey="accHsa" stackId="1" stroke="#16a34a" fill="#16a34a" fillOpacity={0.6} name="HSA" />
                {includeSpouse && <Area type="monotone" dataKey="accSpousePreTax" stackId="1" stroke="#6366f1" fill="#6366f1" fillOpacity={0.5} name="Spouse Pre-Tax" />}
                {includeSpouse && <Area type="monotone" dataKey="accSpouseRoth" stackId="1" stroke="#a855f7" fill="#a855f7" fillOpacity={0.5} name="Spouse Roth" />}
                <Area type="monotone" dataKey="accTaxable" stackId="1" stroke="#ea580c" fill="#ea580c" fillOpacity={0.6} name="Taxable Brokerage" />
                <Area type="monotone" dataKey="accSavings" stackId="1" stroke="#65a30d" fill="#65a30d" fillOpacity={0.5} name="Cash Savings" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── 457(b) Bridge Explainer ── */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <h4 className="font-bold text-emerald-900 mb-1">Why 457(b) Matters</h4>
          <p className="text-sm text-emerald-800">
            Unlike 401(k) and 401(a) plans, a governmental 457(b) has <strong>no 10% early withdrawal penalty</strong> after separation from your employer — regardless of your age. If you retire before 59½, the 457(b) becomes your penalty-free bridge to cover living expenses while leaving penalized accounts untouched until they become penalty-free at 59½. The more you contribute to 457(b) now, the longer that bridge lasts.
          </p>
          {retiresBefore59 && netWorthProjection.length > 0 && (() => {
            const retireData = netWorthProjection.find((d) => d.age === retirementAge);
            const bridge457b = retireData ? retireData.acc457b : 0;
            const annualSpend = monthlySpending * 12;
            const bridgeYears = annualSpend > 0 ? (bridge457b / annualSpend).toFixed(1) : '—';
            return (
              <p className="text-sm text-emerald-700 mt-2 font-medium">
                At retirement (age {retirementAge}), your projected 457(b) balance of {formatCurrency(bridge457b)} covers approximately <strong>{bridgeYears} years</strong> of current annual spending before needing to touch penalized accounts.
              </p>
            );
          })()}
        </div>

        {/* ── Monte Carlo Analysis ── */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <h3 className="text-lg font-bold text-indigo-900 mb-3">Monte Carlo Probability Analysis</h3>
          <p className="text-xs text-indigo-700 mb-3">
            {monteCarloData.numSims} simulations with randomized annual returns (mean: {(blendedReturn * 100).toFixed(1)}%, vol: {monteCarloData.portfolioVol.toFixed(1)}%). Each simulation draws a different sequence of market returns to stress-test the plan against real-world uncertainty.
          </p>

          {/* Success rate gauge */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className={`rounded-lg p-4 text-center ${monteCarloData.successRate >= 90 ? 'bg-green-100 border border-green-300' : monteCarloData.successRate >= 75 ? 'bg-yellow-100 border border-yellow-300' : 'bg-red-100 border border-red-300'}`}>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1 opacity-70">Success Rate</div>
              <div className={`text-3xl font-bold ${monteCarloData.successRate >= 90 ? 'text-green-800' : monteCarloData.successRate >= 75 ? 'text-yellow-800' : 'text-red-800'}`}>
                {monteCarloData.successRate.toFixed(0)}%
              </div>
              <div className="text-xs mt-1 opacity-70">Plans funded through age 90</div>
            </div>

            <div className="bg-white rounded-lg p-4 text-center border border-indigo-200">
              <div className="text-xs font-semibold uppercase tracking-wide mb-1 text-gray-500">Failure Scenarios</div>
              <div className="text-3xl font-bold text-gray-900">{monteCarloData.failCount}</div>
              <div className="text-xs mt-1 text-gray-500">of {monteCarloData.numSims} ran out of money</div>
            </div>

            <div className="bg-white rounded-lg p-4 text-center border border-indigo-200">
              <div className="text-xs font-semibold uppercase tracking-wide mb-1 text-gray-500">Worst-Case Shortfall</div>
              <div className="text-3xl font-bold text-gray-900">
                {monteCarloData.p10ShortfallAge ? `Age ${monteCarloData.p10ShortfallAge}` : 'None'}
              </div>
              <div className="text-xs mt-1 text-gray-500">{monteCarloData.p10ShortfallAge ? '10th percentile of failures' : 'No shortfall in any simulation'}</div>
            </div>
          </div>

          {/* Net worth ranges at key ages */}
          <h4 className="font-bold text-indigo-900 text-sm mb-2">Net Worth Distribution at Key Ages</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2 border-indigo-300">
                  <th className="py-1.5 text-left text-indigo-800 font-bold">Age</th>
                  <th className="py-1.5 text-right text-indigo-800 font-bold">10th %ile</th>
                  <th className="py-1.5 text-right text-indigo-800 font-bold">25th %ile</th>
                  <th className="py-1.5 text-right text-indigo-800 font-bold">Median</th>
                  <th className="py-1.5 text-right text-indigo-800 font-bold">75th %ile</th>
                  <th className="py-1.5 text-right text-indigo-800 font-bold">90th %ile</th>
                  <th className="py-1.5 text-right text-indigo-800 font-bold">Fixed Return</th>
                </tr>
              </thead>
              <tbody>
                {monteCarloData.bands
                  .filter((d) => d.age === retirementAge || d.age === 70 || d.age === 75 || d.age === 80 || d.age === 85 || d.age === 90)
                  .filter((d) => d.age >= currentAge)
                  .map((d) => (
                    <tr key={d.age} className={`border-b border-indigo-100 ${d.age === retirementAge ? 'bg-indigo-100 font-semibold' : ''}`}>
                      <td className="py-1.5 text-indigo-900">{d.age}{d.age === retirementAge ? ' (retire)' : ''}</td>
                      <td className={`py-1.5 text-right ${d.p10 < 0 ? 'text-red-600' : 'text-gray-700'}`}>{formatCurrency(d.p10)}</td>
                      <td className={`py-1.5 text-right ${d.p25 < 0 ? 'text-red-600' : 'text-gray-700'}`}>{formatCurrency(d.p25)}</td>
                      <td className="py-1.5 text-right text-indigo-900 font-semibold">{formatCurrency(d.p50)}</td>
                      <td className="py-1.5 text-right text-gray-700">{formatCurrency(d.p75)}</td>
                      <td className="py-1.5 text-right text-gray-700">{formatCurrency(d.p90)}</td>
                      <td className="py-1.5 text-right text-blue-700">{formatCurrency(d.deterministic)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Monte Carlo fan chart */}
          <div className="mt-4">
            <h4 className="font-bold text-indigo-900 text-sm mb-2">Net Worth Probability Bands</h4>
            <div style={{ height: 350 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monteCarloData.bands} margin={{ top: 10, right: 25, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mcTlBand90" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#818cf8" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#818cf8" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="mcTlBand75" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="age" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis
                    tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    width={55}
                  />
                  <Tooltip content={<StackedTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />

                  {/* Phase boundary reference lines */}
                  {phaseStats.map((phase, idx) => {
                    if (idx === 0) return null;
                    return (
                      <ReferenceLine
                        key={`mc-phase-${idx}`}
                        x={phase.startAge}
                        stroke="#374151"
                        strokeDasharray="4 3"
                        strokeWidth={1.5}
                        label={{ value: phase.label, position: 'top', fontSize: 9, fill: '#374151', fontWeight: 600 }}
                      />
                    );
                  })}

                  <Area type="monotone" dataKey="p90" stackId="none" stroke="none" fill="url(#mcTlBand90)" fillOpacity={1} name="90th %ile" />
                  <Area type="monotone" dataKey="p10" stackId="none" stroke="none" fill="#fff" fillOpacity={0} name="10th %ile" legendType="none" />
                  <Area type="monotone" dataKey="p75" stackId="none" stroke="none" fill="url(#mcTlBand75)" fillOpacity={1} name="75th %ile" />
                  <Area type="monotone" dataKey="p25" stackId="none" stroke="none" fill="#fff" fillOpacity={0} name="25th %ile" legendType="none" />
                  <Area type="monotone" dataKey="p50" stackId="none" stroke="#4f46e5" strokeWidth={2.5} fill="none" name="Median" />
                  <Area type="monotone" dataKey="deterministic" stackId="none" stroke="#0284c7" strokeWidth={1.5} strokeDasharray="6 3" fill="none" name="Fixed Return" />
                  <ReferenceLine y={0} stroke="#dc2626" strokeWidth={1} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Interpretation guidance */}
          <div className="mt-3 text-xs text-indigo-700 space-y-1">
            <p><strong>How to read this:</strong> The dashed blue line is your current plan using a fixed average return. The purple bands show what could happen with real-world market volatility. The wider the bands, the more uncertainty.</p>
            <p><strong>Success rate interpretation:</strong> Financial planners generally target 80-90%+. Below 75% suggests meaningful risk of running out of money. Above 95% may indicate you could spend more or retire earlier.</p>
            <p><strong>Limitations:</strong> This uses a simple normal distribution for returns. Real markets have fatter tails (crashes happen more than a bell curve predicts), so treat this as optimistic on the downside. Returns are also assumed to be independent year-to-year, ignoring mean reversion and regime changes.</p>
          </div>
        </div>
      </div>
    );
  };

  // ──────────────────────────── ASSUMPTIONS TAB ────────────────────────────
  const renderAssumptions = () => {
    // Helper: render a row in the assumptions table
    const Row = ({ label, value, note }) => (
      <tr className="border-b border-gray-100">
        <td className="py-2 pr-4 text-sm text-gray-700 font-medium">{label}</td>
        <td className="py-2 pr-4 text-sm text-gray-900 font-semibold whitespace-nowrap">{value}</td>
        {note !== undefined && <td className="py-2 text-xs text-gray-500">{note}</td>}
      </tr>
    );

    const Section = ({ title, children }) => (
      <div className="mb-6">
        <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wide border-b-2 border-blue-500 pb-1 mb-2">{title}</h4>
        <table className="w-full">
          <tbody>{children}</tbody>
        </table>
      </div>
    );

    const perfRate = yearsOfService < 10 ? '1%' : yearsOfService < 20 ? '1.5%' : '2%';

    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500 mb-4">
          These are the hardcoded constants, IRS limits, and modeling assumptions the projection engine uses.
          If any value looks wrong, flag it — most are set to 2026 IRS guidance and employer plan documents.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          {/* ── Left Column ── */}
          <div>
            <Section title="2026 IRS Limits">
              <Row label="401(k) Elective Deferral" value={formatCurrency(IRS_401K_LIMIT)} note="IRC §402(g)" />
              <Row label="401(k) Catch-Up (age 50+)" value={formatCurrency(IRS_401K_CATCHUP)} note="IRC §414(v)" />
              <Row label="401(k) Super Catch-Up (age 60–63)" value={formatCurrency(IRS_401K_SUPER_CATCHUP)} note="SECURE 2.0" />
              <Row label="457(b) Deferral Limit" value={formatCurrency(IRS_457B_LIMIT)} note="Same as 401(k), separate cap" />
              <Row label="457(b) Catch-Up (age 50+)" value={formatCurrency(IRS_401K_CATCHUP)} note="Same as 401(k)" />
              <Row label="457(b) Super Catch-Up (age 60–63)" value={formatCurrency(IRS_401K_SUPER_CATCHUP)} note="SECURE 2.0 — gov 457(b)" />
              <Row label="Annual Additions Limit (415(c))" value={formatCurrency(IRS_415C_LIMIT)} note="Employee + employer total" />
              <Row label="Compensation Limit (401(a)(17))" value={formatCurrency(IRS_COMP_LIMIT)} note="Max comp for match/contrib calc" />
              <Row label="IRA Contribution Limit" value={formatCurrency(IRS_IRA_LIMIT)} note="Traditional + Roth combined" />
              <Row label="IRA Catch-Up (age 50+)" value={formatCurrency(IRS_IRA_CATCHUP)} />
              <Row label="HSA Limit (Self-Only)" value={formatCurrency(IRS_HSA_SELF)} />
              <Row label="HSA Limit (Family)" value={formatCurrency(IRS_HSA_FAMILY)} />
              <Row label="HSA Catch-Up (age 55+)" value={formatCurrency(IRS_HSA_CATCHUP)} />
              <Row label="Social Security Wage Base" value="$184,500" note="FICA SS cap per earner" />
            </Section>

            <Section title="Tax Rates & Deductions">
              <Row label="Federal Tax Brackets" value="2026 brackets" note="10% / 12% / 22% / 24% / 32% / 35% / 37%" />
              <Row label="NC State Income Tax" value="3.99% flat" note="Applied to NC taxable income (effective 2026)" />
              <Row label="FICA — Social Security" value="6.2%" note={`On first $184,500 per earner`} />
              <Row label="FICA — Medicare" value="1.45%" note="On all earned income" />
              <Row label="Additional Medicare" value="0.9%" note={filingStatus === 'MFJ' ? 'Over $250K combined (MFJ)' : 'Over $200K (Single/HOH)'} />
              <Row label="NIIT" value="3.8%" note={`On net investment income above $${(NIIT_THRESHOLDS[filingStatus] || 250000).toLocaleString()} MAGI (IRC §1411)`} />
              <Row label="Standard Deduction (Federal)" value={formatCurrency(standardDeductions)} note={`Filing: ${filingStatus}`} />
              <Row label="NC Standard Deduction" value={formatCurrency(ncTaxDeduction)} note={filingStatus === 'MFJ' || filingStatus === 'MFS' ? 'MFJ/MFS' : 'Single/HOH'} />
              <Row label="Retirement Withdrawal Tax Rate" value={`${retirementTaxRate}%`} note="User-set effective rate on pre-tax draws" />
            </Section>

            <Section title="Employer Contributions">
              <Row label="Match Formula" value="75% first 4% + 50% next 2%" note="On comp up to §401(a)(17) limit" />
              <Row label="Match Comp Base" value={formatCurrency(Math.min(totalComp, IRS_COMP_LIMIT))} note={totalComp > IRS_COMP_LIMIT ? `Capped from ${formatCurrency(totalComp)}` : 'Full comp used'} />
              <Row label="Calculated Match" value={formatCurrency(employerMatch)} />
              <Row label="Basic Contribution" value={`2% = ${formatCurrency(basicContribution)}`} note="Automatic, no deferral required" />
              <Row label="Performance Contribution" value={`${perfRate} = ${formatCurrency(performanceContribution)}`} note={`Based on ${yearsOfService} years of service`} />
              <Row label="Total Employer" value={formatCurrency(employerMatch + basicContribution + performanceContribution)} note="Match + Basic + Performance" />
            </Section>
          </div>

          {/* ── Right Column ── */}
          <div>
            <Section title="Investment Return Assumptions">
              <Row label="Equity Return" value="7.0% nominal" note="Long-term US equity average" />
              <Row label="Bond Return" value="4.5% nominal" note="Investment-grade bond assumption" />
              <Row label="Your Equity Allocation" value={`${equityAllocation}%`} note="User-adjustable" />
              <Row label="Blended Return" value={`${(blendedReturn * 100).toFixed(2)}%`} note={`${equityAllocation}% × 7% + ${100 - equityAllocation}% × 4.5%`} />
              <Row label="Taxable Account Drag" value="1.0% / year" note="Dividends, cap gains, turnover" />
              <Row label="Cash Savings (HYSA)" value="3.0% / year" note="No additional contributions modeled" />
            </Section>

            <Section title="Monte Carlo Simulation">
              <Row label="Number of Simulations" value={String(monteCarloData.numSims)} note="Each with unique random return sequence" />
              <Row label="Equity Volatility" value="16.0%" note="Annual std dev, historical S&P 500" />
              <Row label="Bond Volatility" value="6.0%" note="Annual std dev, aggregate bond index" />
              <Row label="Stock-Bond Correlation" value="0.10" note="Low positive correlation assumed" />
              <Row label="Portfolio Volatility" value={`${monteCarloData.portfolioVol.toFixed(1)}%`} note={`Blended from ${equityAllocation}% equity / ${100 - equityAllocation}% bonds`} />
              <Row label="Return Distribution" value="Normal (Gaussian)" note="Annual returns drawn from N(μ, σ²)" />
              <Row label="Return Clamping" value="–50% to +60%" note="Prevents extreme outlier blow-ups" />
              <Row label="PRNG" value="Mulberry32 (seeded)" note="Deterministic per scenario for reproducibility" />
              <Row label="Success Rate" value={`${monteCarloData.successRate.toFixed(1)}%`} note="% of sims funded through age 90" />
            </Section>

            <Section title="Retirement & Drawdown">
              <Row label="Retirement Spending Inflation" value="3.0% / year" note="Applied from retirement age forward" />
              <Row label="Retirement Debt Service" value="Funded from draws" note="Debt payments added to annual draw amount" />
              <Row label="Early Withdrawal Penalty" value="10%" note="401(k), 401(a), Trad IRA before age 59½" />
              <Row label="457(b) Penalty" value="$0" note="Exempt after separation from employer" />
              <Row label="59½ Threshold (modeled as)" value="Age 60" note="Conservative simplification" />
              <Row label="Projection End Age" value="90" />
              <Row label="4% Rule (retirement income)" value="4% of projected accounts" note="Used for monthly income estimate only" />
            </Section>

            <Section title="Drawdown Order (Retirement)">
              <Row label="1. Taxable Brokerage" value="No penalty, no tax gross-up" />
              <Row label="2. HSA" value="Tax-free (qualified medical)" />
              <Row label="3. 457(b)" value="Pre-tax, penalty-free after separation" />
              <Row label="4. 401(k) Roth" value="No tax, no penalty" />
              <Row label="5. Roth IRA" value="No tax, no penalty (simplified)" />
              {includeSpouse && <Row label="6. Spouse Roth" value="No tax, no penalty" />}
              <Row label={includeSpouse ? '7. Traditional IRA' : '6. Traditional IRA'} value="Basis-tracked partial tax" note="10% penalty if < 59½" />
              <Row label={includeSpouse ? '8. 401(k) Pre-Tax' : '7. 401(k) Pre-Tax'} value="Full pre-tax rate" note="10% penalty if < 59½" />
              <Row label={includeSpouse ? '9. 401(a)' : '8. 401(a)'} value="Full pre-tax rate" note="10% penalty if < 59½" />
              {includeSpouse && <Row label="10. Spouse Pre-Tax" value="Full pre-tax rate" note="10% penalty if < 59½" />}
              <Row label={includeSpouse ? '11. Cash Savings' : '9. Cash Savings'} value="Last resort — emergency reserve" />
            </Section>

            <Section title="Accumulation Cash Flow Logic">
              <Row label="Priority Order" value="Spending + Debt → Contributions → Taxable investing" note="Mandatory outflows come first" />
              <Row label="Income Sources" value={includeSpouse ? 'Physician + Spouse' : 'Physician only'} />
              <Row label="Contribution Scaling" value="Proportional cutback" note="If take-home < spending + debt + contributions, all employee contributions scale down equally (employer contributions always fund)" />
              <Row label="Tax Recalculation" value="Taxes recomputed with actual deductions" note="Scaled-down pre-tax contributions mean higher taxes" />
              <Row label="Surplus Handling" value="Goes to lifestyle (not reinvested)" />
              <Row label="Deficit Handling" value="Cut taxable investing → Draw savings → Draw brokerage" />
              <Row label="Insolvency Flag" value="Triggered when liquid accounts exhausted" note="Shortfall age shown on chart and Timeline tab" />
              <Row label="Spouse Contributions" value="Stop at spouse retirement age" note={`IRAs + employer plan (${formatCurrency(effSpouseEmployerDeferral + effSpouseEmployerMatch)}/yr total)`} />
              <Row label="Trad IRA Deductibility" value="Non-deductible" note="Income exceeds phase-out w/ workplace plan" />
            </Section>
          </div>
        </div>
      </div>
    );
  };

  const tabs = [
    { label: 'Tax & Summary', icon: TrendingUp, content: renderDashboard },
    { label: 'Income & Comp', icon: DollarSign, content: renderIncomeAndCompensation },
    { label: 'Retirement', icon: PiggyBank, content: renderRetirementContributions },
    { label: 'Budget & Debt', icon: Home, content: renderHouseholdBudgetAndDebt },
    { label: 'Assets & Settings', icon: TrendingUp, content: renderOtherAssetsAndSettings },
    { label: 'Timeline', icon: Clock, content: renderRetirementTimeline },
    // Assumptions tab is always last — add any new tabs ABOVE this line
    { label: 'Assumptions', icon: Info, content: renderAssumptions },
  ];

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 overflow-hidden">

      {/* ── First-launch disclaimer modal ── */}
      {showDisclaimer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-700 to-blue-900 px-6 py-4">
              <h2 className="text-xl font-bold text-white">Physician Financial Planner</h2>
              <p className="text-blue-200 text-sm mt-1">Physician Financial Planning Tool</p>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm text-gray-700 leading-relaxed max-h-96 overflow-y-auto">
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Your Data Stays on Your Device</h3>
                <p>All information you enter is stored entirely in your browser on this device using local storage. Nothing is transmitted to any server, cloud service, or third party. Your inputs are automatically saved and will be restored the next time you open this page in the same browser.</p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Safe Practices</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Your data auto-saves as you type and persists across browser sessions.</li>
                  <li>Use <strong>Export</strong> to back up your data as a file, or to transfer it to another device or browser.</li>
                  <li>Do not share exported files with others — they contain your personal financial information.</li>
                  <li>If using a shared or public computer, clear your browser data or use a private/incognito window.</li>
                  <li>This application does not use cookies, analytics, or tracking of any kind.</li>
                </ul>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <h3 className="font-semibold text-amber-900 mb-1">Important Disclaimer</h3>
                <p className="text-amber-800 text-xs leading-relaxed">This tool is provided for <strong>educational and planning purposes only</strong> and does not constitute financial, tax, investment, or legal advice. Projections are based on simplified assumptions and may not reflect your actual financial outcome. Tax calculations are estimates and should not be used for tax filing. Consult a qualified financial advisor, tax professional, or attorney before making financial decisions. The creators of this tool assume no liability for decisions made based on its output.</p>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
              <button
                onClick={() => { setShowDisclaimer(false); try { localStorage.setItem('physician-fp-disclaimer-accepted', '1'); } catch {} }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-lg transition"
              >
                I Understand — Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 flex flex-col h-full">

        {/* ── FIXED TOP: header + metrics + chart ── */}
        <div className="flex-shrink-0 pt-3 pb-2">
          {/* Header */}
          <div className="flex items-center space-x-3 mb-2">
            <TrendingUp className="w-7 h-7 text-blue-400" />
            <h1 className="text-2xl font-bold text-white">Physician Financial Planner</h1>
            <span className="text-blue-300 text-xs hidden sm:inline">Physician Financial Planning Tool</span>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <p className="text-xs text-blue-600 font-semibold">Net Worth at Retirement</p>
              <p className="text-base font-bold text-blue-900">{formatCurrency(retirementMetrics.projectedNetWorth || 0)}</p>
              {savedScenario && (() => { const d = (retirementMetrics.projectedNetWorth || 0) - savedScenario.metrics.projectedNetWorth; return d !== 0 ? <p className={`text-xs font-semibold ${d > 0 ? 'text-green-700' : 'text-red-700'}`}>{d > 0 ? '+' : ''}{formatCurrency(d)} vs A</p> : null; })()}
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <p className="text-xs text-green-600 font-semibold">Annual Contributions</p>
              <p className="text-base font-bold text-green-900">{formatCurrency(retirementMetrics.totalAnnualContributions || 0)}</p>
              {savedScenario && (() => { const d = (retirementMetrics.totalAnnualContributions || 0) - savedScenario.metrics.totalAnnualContributions; return d !== 0 ? <p className={`text-xs font-semibold ${d > 0 ? 'text-green-700' : 'text-red-700'}`}>{d > 0 ? '+' : ''}{formatCurrency(d)} vs A</p> : null; })()}
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
              <p className="text-xs text-purple-600 font-semibold">Annual Tax Savings</p>
              <p className="text-base font-bold text-purple-900">{formatCurrency(retirementMetrics.estimatedTaxSavings || 0)}</p>
              {savedScenario && (() => { const d = (retirementMetrics.estimatedTaxSavings || 0) - savedScenario.metrics.estimatedTaxSavings; return d !== 0 ? <p className={`text-xs font-semibold ${d > 0 ? 'text-green-700' : 'text-red-700'}`}>{d > 0 ? '+' : ''}{formatCurrency(d)} vs A</p> : null; })()}
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              <p className="text-xs text-orange-600 font-semibold">Monthly Retirement Income</p>
              <p className="text-base font-bold text-orange-900">{formatCurrency(retirementMetrics.monthlyRetirementIncome || 0)}</p>
              {savedScenario && (() => { const d = (retirementMetrics.monthlyRetirementIncome || 0) - savedScenario.metrics.monthlyRetirementIncome; return d !== 0 ? <p className={`text-xs font-semibold ${d > 0 ? 'text-green-700' : 'text-red-700'}`}>{d > 0 ? '+' : ''}{formatCurrency(d)} vs A</p> : null; })()}
            </div>
          </div>

          {/* Net Worth Chart */}
          <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg">
            {netWorthProjection.shortfallAge && (
              <div className="bg-red-100 border border-red-300 rounded px-3 py-1.5 mb-1 flex items-center justify-between">
                <span className="text-xs font-bold text-red-800">
                  Shortfall at age {netWorthProjection.shortfallAge} — {netWorthProjection.shortfallAge < retirementAge ? 'spending exceeds income before retirement' : 'accounts exhausted in retirement'}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-gray-800">
                {showMonteCarlo ? 'Monte Carlo Simulation — Net Worth Percentile Bands' : detailedChart ? 'Account Breakdown & Withdrawal Sequence' : savedScenario ? 'Net Worth Projection — Comparing to Scenario A' : 'Net Worth Projection'} (Age {currentAge} to 90)
              </h3>
              <div className="flex items-center space-x-2">
                {savedScenario ? (
                  <button
                    onClick={() => setSavedScenario(null)}
                    style={{ backgroundColor: '#f59e0b', color: '#fff', fontSize: '12px', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, border: 'none', cursor: 'pointer' }}
                  >
                    Clear Scenario A
                  </button>
                ) : (
                  <button
                    onClick={handleSaveScenario}
                    className="text-xs px-2 py-1 rounded transition font-medium bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    Save as Scenario A
                  </button>
                )}
                <button
                  onClick={() => { setShowMonteCarlo((v) => !v); if (!showMonteCarlo) setDetailedChart(false); }}
                  className={`text-xs px-2 py-1 rounded transition font-medium ${showMonteCarlo ? 'bg-indigo-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                >
                  {showMonteCarlo ? 'Monte Carlo ON' : 'Monte Carlo'}
                </button>
                {!showMonteCarlo && (
                  <button
                    onClick={() => setDetailedChart((v) => !v)}
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded transition font-medium"
                  >
                    {detailedChart ? 'Simple View' : 'Detailed View'}
                  </button>
                )}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={showMonteCarlo ? 260 : detailedChart ? 260 : 200}>
              {showMonteCarlo ? (
                <AreaChart data={monteCarloData.bands} margin={{ top: 5, right: 25, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mcBand90" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#818cf8" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#818cf8" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="mcBand75" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="age" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis
                    tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    width={55}
                  />
                  <Tooltip content={<StackedTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  {retirementAge <= 90 && (
                    <ReferenceLine x={retirementAge} stroke="#dc2626" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Retire (${retirementAge})`, position: 'insideTopRight', fontSize: 9, fill: '#dc2626', fontWeight: 600, dy: -5 }} />
                  )}
                  {/* Fan bands: 10th-90th range, then 25th-75th range */}
                  <Area type="monotone" dataKey="p90" stackId="none" stroke="none" fill="url(#mcBand90)" fillOpacity={1} name="90th %ile" />
                  <Area type="monotone" dataKey="p10" stackId="none" stroke="none" fill="#fff" fillOpacity={0} name="10th %ile" legendType="none" />
                  <Area type="monotone" dataKey="p75" stackId="none" stroke="none" fill="url(#mcBand75)" fillOpacity={1} name="75th %ile" />
                  <Area type="monotone" dataKey="p25" stackId="none" stroke="none" fill="#fff" fillOpacity={0} name="25th %ile" legendType="none" />
                  {/* Median line */}
                  <Area type="monotone" dataKey="p50" stackId="none" stroke="#4f46e5" strokeWidth={2} fill="none" name="Median (50th)" />
                  {/* Deterministic baseline */}
                  <Area type="monotone" dataKey="deterministic" stackId="none" stroke="#0284c7" strokeWidth={1.5} strokeDasharray="6 3" fill="none" name="Fixed Return" />
                </AreaChart>
              ) : detailedChart ? (
                <AreaChart data={chartData} margin={{ top: 5, right: 25, left: 0, bottom: 0 }} stackOffset="none">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="age" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis
                    tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    width={55}
                  />
                  <Tooltip content={<StackedTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  {/* Stacked areas — order matters: bottom to top */}
                  <Area type="monotone" dataKey="acc457b" stackId="1" stroke="#059669" fill="#059669" fillOpacity={0.85} name="457(b)" />
                  <Area type="monotone" dataKey="acc401kPreTax" stackId="1" stroke="#2563eb" fill="#2563eb" fillOpacity={0.7} name="401(k) Pre-Tax" />
                  <Area type="monotone" dataKey="acc401kRoth" stackId="1" stroke="#7c3aed" fill="#7c3aed" fillOpacity={0.7} name="401(k) Roth" />
                  <Area type="monotone" dataKey="acc401a" stackId="1" stroke="#0891b2" fill="#0891b2" fillOpacity={0.7} name="401(a)" />
                  <Area type="monotone" dataKey="accTradIra" stackId="1" stroke="#d97706" fill="#d97706" fillOpacity={0.7} name="Traditional IRA" />
                  <Area type="monotone" dataKey="accRothIra" stackId="1" stroke="#c026d3" fill="#c026d3" fillOpacity={0.7} name="Roth IRA" />
                  <Area type="monotone" dataKey="accHsa" stackId="1" stroke="#16a34a" fill="#16a34a" fillOpacity={0.6} name="HSA" />
                  {includeSpouse && <Area type="monotone" dataKey="accSpousePreTax" stackId="1" stroke="#6366f1" fill="#6366f1" fillOpacity={0.5} name="Spouse Pre-Tax" />}
                  {includeSpouse && <Area type="monotone" dataKey="accSpouseRoth" stackId="1" stroke="#a855f7" fill="#a855f7" fillOpacity={0.5} name="Spouse Roth" />}
                  <Area type="monotone" dataKey="accTaxable" stackId="1" stroke="#ea580c" fill="#ea580c" fillOpacity={0.6} name="Taxable Brokerage" />
                  <Area type="monotone" dataKey="accSavings" stackId="1" stroke="#65a30d" fill="#65a30d" fillOpacity={0.5} name="Cash Savings" />
                  {savedScenario && <Area type="monotone" dataKey="scenarioA" stackId="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" fill="none" fillOpacity={0} name="Scenario A" dot={false} />}
                  </AreaChart>
              ) : (
                <AreaChart data={chartData} margin={{ top: 18, right: 25, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorNetWorth" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="age" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis
                    tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    width={55}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '12px' }}
                    formatter={(value) => formatCurrency(value)}
                    labelFormatter={(label) => `Age: ${label}`}
                  />
                  {retirementAge <= 90 && (
                    <ReferenceLine x={retirementAge} stroke="#dc2626" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Retirement (${retirementAge})`, position: 'insideTopRight', fontSize: 10, fill: '#dc2626', fontWeight: 600, dy: -5 }} />
                  )}
                  <Area
                    type="monotone"
                    dataKey="netWorth"
                    stroke="#0284c7"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorNetWorth)"
                    name="Total Net Worth"
                  />
                  {savedScenario && (
                    <Area
                      type="monotone"
                      dataKey="scenarioA"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      fill="none"
                      fillOpacity={0}
                      name="Scenario A"
                      dot={false}
                    />
                  )}
                </AreaChart>
              )}
            </ResponsiveContainer>
            {showMonteCarlo && (
              <div className="flex items-center justify-between mt-1 px-1">
                <span className="text-xs text-gray-500">{monteCarloData.numSims} simulations · Portfolio vol: {monteCarloData.portfolioVol.toFixed(1)}%</span>
                <span className={`text-xs font-bold ${monteCarloData.successRate >= 90 ? 'text-green-700' : monteCarloData.successRate >= 75 ? 'text-yellow-700' : 'text-red-700'}`}>
                  {monteCarloData.successRate.toFixed(0)}% success rate to age 90
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── SCROLLABLE BOTTOM: tab bar + tab content ── */}
        <div className="flex-1 flex flex-col min-h-0 mt-2 pb-2">
          {/* Tab bar — fixed within this section */}
          <div className="flex-shrink-0 bg-white rounded-t-lg shadow-lg">
            <div className="flex border-b border-gray-200">
              {tabs.map((tab, index) => {
                const IconComponent = tab.icon;
                return (
                  <button
                    key={index}
                    onClick={() => setActiveTab(index)}
                    className={`flex-1 px-3 py-2.5 text-sm font-semibold transition flex items-center justify-center space-x-1.5 ${
                      activeTab === index
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <IconComponent className="w-4 h-4" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab content — scrollable */}
          <div className="flex-1 overflow-y-auto bg-white rounded-b-lg shadow-lg px-6 py-5">
            {tabs[activeTab].content()}

            {/* Disclaimer — inside scroll area at the bottom */}
            <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-xs text-yellow-800">
                <strong>Disclaimer:</strong> This tool is for educational and planning purposes only. It does not constitute financial, tax, or investment advice. Consult a qualified financial advisor for personalized guidance.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default PhysicianFinancialPlanner;
