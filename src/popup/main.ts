import "./styles.css";

async function openSidePanel() {
  const win = await chrome.windows.getCurrent();
  if (win.id == null) return;
  await chrome.sidePanel.open({ windowId: win.id });
}

document.getElementById("open")?.addEventListener("click", () => {
  void openSidePanel();
});

void openSidePanel().catch(() => {
  // Side panel may require a fresh user gesture in some Chrome builds.
});
