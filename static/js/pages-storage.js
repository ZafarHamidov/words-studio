/* Progress backup controls for both editions. Edit when backup UI changes. */
document.getElementById('btn-export-progress').addEventListener('click', async () => {
  try {
    const backup = await Api.exportProgress();
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `words-studio-progress-${new Date().toISOString().slice(0, 10)}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    Toast.show('Progress backup downloaded', 'success');
  } catch (error) { Toast.show(error.error || 'Could not export progress', 'error'); }
});
document.getElementById('progress-import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 50 * 1024 * 1024) throw { error: 'Backup must be smaller than 50 MB.' };
    const backup = JSON.parse(await file.text());
    if (!confirm('Replace your current study progress with this backup? Export your current progress first if you want to keep it.')) return;
    await Api.importProgress(backup);
    location.reload();
  } catch (error) { Toast.show(error.error || 'Could not import this backup', 'error'); }
  finally { event.target.value = ''; }
});
