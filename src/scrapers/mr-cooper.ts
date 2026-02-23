import puppeteer from '@cloudflare/puppeteer';

export interface PaymentHistoryEntry {
  date: string;
  amount: number;
  principal?: number;
  interest?: number;
  escrow?: number;
}

export interface MrCooperResult {
  success: boolean;
  data?: {
    property: string;
    currentBalance: number;
    monthlyPayment: number;
    escrowBalance: number;
    interestRate: number;
    payoffAmount?: number;
    nextPaymentDate?: string;
    paymentHistory: PaymentHistoryEntry[];
  };
  error?: string;
}

/**
 * Scrape Mr. Cooper (mrcooper.com) mortgage portal for loan data.
 *
 * Logs in with credentials, navigates to the mortgage dashboard,
 * and extracts balance, payment, escrow, rate, and payment history.
 *
 * NOTE: CSS selectors are best-effort based on typical Mr. Cooper portal
 * structure and will need verification/adaptation against the live site.
 * Mr. Cooper may also employ CAPTCHA or 2FA which would require manual
 * intervention or additional handling.
 */
export async function scrapeMrCooper(
  browser: Fetcher,
  credentials: { username: string; password: string },
  property: string
): Promise<MrCooperResult> {
  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate to Mr. Cooper login page
    await page.goto('https://www.mrcooper.com/login', {
      waitUntil: 'networkidle0',
      timeout: 20000,
    });

    // Enter username -- try multiple selectors for resilience
    const usernameSelector = await resolveSelector(page, [
      '#username',
      'input[name="username"]',
      'input[name="email"]',
      '#loginUsername',
      'input[type="email"]',
      'input[data-testid="username"]',
    ]);
    if (!usernameSelector) {
      return { success: false, error: 'Could not find username input on login page' };
    }
    await page.type(usernameSelector, credentials.username);

    // Enter password
    const passwordSelector = await resolveSelector(page, [
      '#password',
      'input[name="password"]',
      '#loginPassword',
      'input[type="password"]',
      'input[data-testid="password"]',
    ]);
    if (!passwordSelector) {
      return { success: false, error: 'Could not find password input on login page' };
    }
    await page.type(passwordSelector, credentials.password);

    // Click the login/submit button
    const submitSelector = await resolveSelector(page, [
      'button[type="submit"]',
      '#loginButton',
      'button[data-testid="login-button"]',
      'input[type="submit"]',
      '.login-button',
      'button.btn-primary',
    ]);
    if (!submitSelector) {
      return { success: false, error: 'Could not find login submit button' };
    }
    await page.click(submitSelector);

    // Wait for navigation after login
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {
      // Some SPAs don't trigger a full navigation on login
    });

    // Allow time for SPA rendering
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check for login failure indicators
    const loginFailed = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      if (!doc) return false;

      // Check for common error message patterns
      const errorSelectors = [
        '.error-message',
        '.login-error',
        '[data-testid="error-message"]',
        '.alert-danger',
        '.alert-error',
        '#errorMessage',
        '.form-error',
      ];
      for (const sel of errorSelectors) {
        const el = doc.querySelector(sel);
        if (el && (el.textContent || '').trim().length > 0) return true;
      }

      // Check for CAPTCHA presence
      const captchaSelectors = [
        'iframe[src*="recaptcha"]',
        'iframe[src*="captcha"]',
        '.g-recaptcha',
        '#captcha',
        '[data-testid="captcha"]',
      ];
      for (const sel of captchaSelectors) {
        if (doc.querySelector(sel)) return true;
      }

      // Check if we're still on the login page
      const url = (globalThis as any).location?.href || '';
      if (url.includes('/login') || url.includes('/signin')) {
        // Still on login page after submit -- likely failed
        return true;
      }

      return false;
    });

    if (loginFailed) {
      return {
        success: false,
        error: 'Login failed -- credentials may be incorrect, CAPTCHA present, or 2FA required',
      };
    }

    // Extract mortgage dashboard data
    const mortgageData = await page.evaluate((inputProperty: string) => {
      const doc = (globalThis as any).document;
      if (!doc) return null;

      // Helper to extract text from first matching selector
      const text = (...selectors: string[]): string => {
        for (const sel of selectors) {
          const el = doc.querySelector(sel);
          if (el) {
            const t = (el.textContent || '').trim();
            if (t.length > 0) return t;
          }
        }
        return '';
      };

      // Helper to parse currency string to number
      const parseCurrency = (s: string): number => {
        const cleaned = s.replace(/[$,\s]/g, '');
        const val = parseFloat(cleaned);
        return isNaN(val) ? 0 : val;
      };

      // Helper to parse percentage string to number
      const parseRate = (s: string): number => {
        const cleaned = s.replace(/[%\s]/g, '');
        const val = parseFloat(cleaned);
        return isNaN(val) ? 0 : val;
      };

      // Current balance / unpaid principal balance
      const balanceText = text(
        '[data-testid="current-balance"]',
        '[data-testid="principal-balance"]',
        '.current-balance',
        '.principal-balance',
        '.unpaid-balance',
        '#currentBalance',
        '#principalBalance',
        '.loan-balance .amount',
        '.balance-amount',
      );
      const currentBalance = parseCurrency(balanceText);

      // Monthly payment amount
      const paymentText = text(
        '[data-testid="monthly-payment"]',
        '.monthly-payment',
        '.payment-amount',
        '#monthlyPayment',
        '.total-payment .amount',
        '.payment-due .amount',
      );
      const monthlyPayment = parseCurrency(paymentText);

      // Escrow balance
      const escrowText = text(
        '[data-testid="escrow-balance"]',
        '.escrow-balance',
        '#escrowBalance',
        '.escrow .amount',
        '.escrow-amount',
      );
      const escrowBalance = parseCurrency(escrowText);

      // Interest rate
      const rateText = text(
        '[data-testid="interest-rate"]',
        '.interest-rate',
        '#interestRate',
        '.rate-value',
        '.loan-rate',
      );
      const interestRate = parseRate(rateText);

      // Payoff amount (may not always be visible on dashboard)
      const payoffText = text(
        '[data-testid="payoff-amount"]',
        '.payoff-amount',
        '#payoffAmount',
        '.payoff .amount',
      );
      const payoffAmount = parseCurrency(payoffText) || undefined;

      // Next payment due date
      const nextPaymentDate = text(
        '[data-testid="next-payment-date"]',
        '.next-payment-date',
        '#nextPaymentDate',
        '.payment-due-date',
        '.due-date',
      ) || undefined;

      return {
        property: inputProperty,
        currentBalance,
        monthlyPayment,
        escrowBalance,
        interestRate,
        payoffAmount,
        nextPaymentDate,
      };
    }, property);

    if (!mortgageData) {
      return {
        success: false,
        error: 'Could not extract mortgage data -- page structure may have changed',
      };
    }

    // Verify we got meaningful data (at least balance or payment)
    if (mortgageData.currentBalance === 0 && mortgageData.monthlyPayment === 0) {
      return {
        success: false,
        error: 'No mortgage data found -- dashboard may have changed or property not found',
      };
    }

    // Best-effort: navigate to payment history
    let paymentHistory: PaymentHistoryEntry[] = [];
    try {
      // Try to click a payment history link/tab
      const historyLinkSelector = await resolveSelector(page, [
        'a[href*="payment-history"]',
        'a[href*="paymenthistory"]',
        'a[href*="payments"]',
        '[data-testid="payment-history-link"]',
        '.payment-history-link',
        'a:has-text("Payment History")',
        'a:has-text("payment history")',
        '.nav-link[href*="history"]',
      ]);

      if (historyLinkSelector) {
        await page.click(historyLinkSelector);
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 2000));

        paymentHistory = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          if (!doc) return [];

          const parseCurrency = (s: string): number => {
            const cleaned = s.replace(/[$,\s]/g, '');
            const val = parseFloat(cleaned);
            return isNaN(val) ? 0 : val;
          };

          const entries: Array<{
            date: string;
            amount: number;
            principal?: number;
            interest?: number;
            escrow?: number;
          }> = [];

          // Try table-based payment history
          const rows = doc.querySelectorAll(
            '.payment-history-table tr, ' +
            '.payment-history tbody tr, ' +
            '[data-testid="payment-history-row"], ' +
            '.transaction-row, ' +
            '.history-table tbody tr'
          );

          if (rows && rows.length > 0) {
            for (let i = 0; i < rows.length && i < 24; i++) {
              const cells = rows[i].querySelectorAll('td');
              if (cells.length >= 2) {
                const dateText = (cells[0]?.textContent || '').trim();
                const amountText = (cells[1]?.textContent || '').trim();

                // Skip header rows that snuck through
                if (dateText.toLowerCase().includes('date') || !dateText) continue;

                const entry: {
                  date: string;
                  amount: number;
                  principal?: number;
                  interest?: number;
                  escrow?: number;
                } = {
                  date: dateText,
                  amount: parseCurrency(amountText),
                };

                // Try to extract breakdown columns if available
                if (cells.length >= 3) entry.principal = parseCurrency(cells[2]?.textContent || '') || undefined;
                if (cells.length >= 4) entry.interest = parseCurrency(cells[3]?.textContent || '') || undefined;
                if (cells.length >= 5) entry.escrow = parseCurrency(cells[4]?.textContent || '') || undefined;

                if (entry.amount > 0) {
                  entries.push(entry);
                }
              }
            }
          }

          // Fallback: try card/list-based payment history layout
          if (entries.length === 0) {
            const cards = doc.querySelectorAll(
              '.payment-card, .payment-item, .transaction-item, [data-testid="payment-entry"]'
            );
            if (cards) {
              for (let i = 0; i < cards.length && i < 24; i++) {
                const card = cards[i];
                const dateEl = card.querySelector('.date, .payment-date, [data-testid="payment-date"]');
                const amountEl = card.querySelector('.amount, .payment-amount, [data-testid="payment-amount"]');
                if (dateEl && amountEl) {
                  entries.push({
                    date: (dateEl.textContent || '').trim(),
                    amount: parseCurrency(amountEl.textContent || ''),
                  });
                }
              }
            }
          }

          return entries;
        }) || [];
      }
    } catch {
      // Payment history is best-effort -- swallow errors
    }

    return {
      success: true,
      data: {
        ...mortgageData,
        paymentHistory,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

/**
 * Try multiple CSS selectors and return the first one that matches an element on the page.
 * Returns null if none match.
 */
async function resolveSelector(page: any, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) return selector;
    } catch {
      // Some selectors (like :has-text) may not be valid CSS -- skip
    }
  }
  return null;
}
