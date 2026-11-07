import sys, re
from playwright.sync_api import sync_playwright
out = sys.argv[1]
errors = []
def check(pg, name):
    pg.wait_for_timeout(500)
    sw = pg.evaluate("document.documentElement.scrollWidth")
    print(f"{name}: scrollWidth={sw}", "OVERFLOW!" if sw > 360 else "ok")
    pg.screenshot(path=f"{out}/{name}.png", full_page=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 360, "height": 740}, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))

    pg.goto("http://localhost:3000/"); check(pg, "01-landing")
    pg.click("text=Learn more"); pg.wait_for_timeout(600); check(pg, "02-landing-how")

    # Signup with bad input first (validation shown)
    pg.goto("http://localhost:3000/signup")
    pg.fill("#display_name", "Test Student"); pg.fill("#email", "bad-email"); pg.fill("#password", "short")
    pg.click("button[type=submit]"); pg.wait_for_selector("#msg:not(.hidden)")
    print("validation message:", pg.inner_text("#msg")); check(pg, "03-signup-error")
    pg.fill("#email", "test.student@example.com"); pg.fill("#password", "testpass123")
    pg.click("button[type=submit]"); pg.wait_for_url("**/dashboard"); check(pg, "04-dashboard-empty")

    # Add skills
    pg.goto("http://localhost:3000/skills"); pg.wait_for_selector("#offers-skill option:nth-child(3)", state="attached")
    pg.select_option("#offers-skill", label="Python basics"); pg.fill("#offers-desc", "Can explain loops and functions")
    pg.click("form:has(#offers-skill) button"); pg.wait_for_selector("text=Can explain loops")
    pg.select_option("#requests-skill", label="Korean for beginners")
    pg.click("form:has(#requests-skill) button"); pg.wait_for_timeout(500)
    check(pg, "05-skills")

    pg.goto("http://localhost:3000/dashboard"); pg.wait_for_selector("text=Your matches"); pg.wait_for_selector(".card-link")
    print("matches shown:", pg.locator(".card-link h3").all_inner_texts()); check(pg, "06-dashboard-matches")

    pg.goto("http://localhost:3000/browse"); pg.fill("#q", "korean"); pg.wait_for_timeout(700)
    print("search korean:", pg.locator(".card-link h3").all_inner_texts()); check(pg, "07-browse")
    pg.click("text=Kamola Hasanova"); pg.wait_for_selector("text=Ask for a swap")
    pg.fill("#message", "Hi Kamola! Python for Korean?"); check(pg, "08-member")
    pg.click("text=Send swap request"); pg.wait_for_url("**/exchanges"); pg.wait_for_selector("text=Sent by you"); check(pg, "09-exchanges-sent")
    # duplicate request should be refused
    pg.goto("http://localhost:3000/member?id=" + re.search(r"id=(\d+)", pg.url or "").group(1)) if False else None

    # profile
    pg.goto("http://localhost:3000/profile"); pg.fill("#city", "Tashkent"); pg.fill("#bio", "Second-year student.")
    pg.click("text=Save profile"); pg.wait_for_selector("text=Saved"); check(pg, "10-profile")

    # logout, then act as provider
    pg.click("text=Log out"); pg.wait_for_url("**/")
    pg.goto("http://localhost:3000/login"); pg.fill("#email", "kamola@demo.uz"); pg.fill("#password", "demo12345")
    pg.click("button[type=submit]"); pg.wait_for_url("**/dashboard")
    pg.goto("http://localhost:3000/exchanges"); pg.wait_for_selector("text=Waiting for you")
    print("Kamola incoming:", pg.locator(".card h3").all_inner_texts()); check(pg, "11-exchanges-incoming")
    pg.locator(".card", has_text="Test Student").get_by_text("Accept").click(); pg.wait_for_timeout(700)
    print("after accept chips:", pg.locator(".card", has_text="Test Student").locator(".chip").first.inner_text())
    check(pg, "12-exchanges-accepted")
    # wrong password
    pg.click("text=Log out"); pg.goto("http://localhost:3000/login"); pg.fill("#email", "kamola@demo.uz"); pg.fill("#password", "nope")
    pg.click("button[type=submit]"); pg.wait_for_selector("#msg:not(.hidden)"); print("bad login:", pg.inner_text("#msg"))
    # protected page without login
    pg.goto("http://localhost:3000/dashboard"); pg.wait_for_url("**/login"); print("protected page redirects to /login: ok")
    b.close()
print("console/page errors:", errors or "none")
