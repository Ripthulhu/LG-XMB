from pathlib import Path

def replace(name, old, new):
    path = Path(name)
    text = path.read_text()
    assert text.count(old) == 1, (name, text.count(old))
    path.write_text(text.replace(old, new))

replace('tv-helper/recovery/test_startup_hook.py',
        "patch.object(recovery, 'inspect_hook', return_value=(fd, recovery.read_hook(fd)))",
        "patch.object(recovery, 'inspect_hook', side_effect=[(fd, recovery.read_hook(fd)), (None, None)])")
replace('tests/input-labels-browser.cjs',
        "const storage = await page.evaluate(() => JSON.stringify(localStorage));",
        """const storage = await page.evaluate(() => JSON.stringify(localStorage));
    const setupCommands = await page.evaluate(() => labelTest.commands.slice());
    assert.equal(setupCommands.length, 1, 'one independent bundled-helper setup');
    assert.match(setupCommands[0], /helper-startup\\.py ensure/);""")
replace('tests/input-labels-browser.cjs',
        "assert.deepEqual(await page.evaluate(() => labelTest.commands), []);",
        "assert.deepEqual(await page.evaluate(() => labelTest.commands), setupCommands, 'denied label discovery adds no root fallback');")
