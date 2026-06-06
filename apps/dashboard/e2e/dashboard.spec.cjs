const { expect, test } = require("@playwright/test");

test("creates a project through the onboarding UI", async ({ page }) => {
  const name = `E2E Throwaway ${Date.now()}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Personal project swarm" })).toBeVisible();

  await page.getByRole("link", { name: /New Project/ }).click();
  await page.getByLabel("Describe the project however you want").fill(
    "A throwaway web dashboard for tracking tiny experiments. Keep it local, fake external services, and make the first screen useful."
  );
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: /Generate proposal/ }).click();

  await expect(page.getByText("Review proposal")).toBeVisible();
  await expect(page.getByText("Edit generated files")).toBeVisible();

  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Project files")).toBeVisible();
  await expect(page.getByText("QUEUE.md")).toBeVisible();

  await page.getByRole("link", { name: /^Projects$/ }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
});
