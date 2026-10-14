/** Sign-in guards: a wrong code is refused, and signed-out pages redirect. */
import { confirmAgeAndSend, expect, OTP, test, testEmail } from './fixtures';

test('a wrong sign-in code is refused and the right one works', async ({ page }) => {
  await page.goto('/plan');
  await expect(page).toHaveURL(/\/login\?next=%2Fplan$/);
  await page.getByPlaceholder('you@example.com').fill(testEmail('golden-auth@rightdue.app'));
  // D7: no code is sent before the 18+ declaration.
  await expect(page.getByRole('button', { name: /send code/i })).toBeDisabled();
  await confirmAgeAndSend(page);
  await page.getByPlaceholder('••••••').fill('000000');
  await page.getByRole('button', { name: /verify and sign in/i }).click();
  await expect(page.getByText(/Incorrect code/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await page.getByPlaceholder('••••••').fill(OTP);
  await page.getByRole('button', { name: /verify and sign in/i }).click();
  // A new account has no profile yet, so the plan sends it to setup.
  await expect(page).toHaveURL(/\/onboarding$/);
});
