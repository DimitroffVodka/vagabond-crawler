/**
 * Vagabond Crawler — Dialog Helpers (ApplicationV2)
 *
 * Replaces deprecated Dialog.confirm / Dialog.wait with
 * foundry.applications.api.DialogV2 equivalents.
 */

const { DialogV2 } = foundry.applications.api;

/**
 * Drop-in replacement for Dialog.confirm()
 * Returns true if confirmed, false/null if cancelled.
 */
export async function confirmDialog({ title, content }) {
  const result = await DialogV2.confirm({
    window: { title },
    content: `<p>${content}</p>`,
    rejectClose: false,
  });
  return result === true;
}

/**
 * Drop-in replacement for Dialog.wait() with multiple buttons.
 * buttons: [{ label, icon, value }]
 * Returns the value of the clicked button, or null if closed.
 */
export async function waitDialog({ title, content, buttons, defaultButton, width = 400 }) {
  const result = await DialogV2.wait({
    window: { title },
    content,
    buttons: buttons.map(b => ({
      label: b.label,
      icon: b.icon ? `<i class="${b.icon}"></i>` : undefined,
      action: b.value ?? b.label.toLowerCase(),
      default: b.value === defaultButton,
    })),
    rejectClose: false,
    position: { width },
  });
  return result ?? null;
}
