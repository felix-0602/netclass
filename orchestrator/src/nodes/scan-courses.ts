import type { OrchestratorState } from '../state';
import type { BrowserClient } from '../browser';

export async function scanCourses(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  const { BrowserClient } = await import('../browser');
  const browser = new BrowserClient();

  const courses: OrchestratorState['courses'] = [];

  try {
    // Navigate to 超星 base page
    await browser.goto('https://i.chaoxing.com/base');
    await new Promise(r => setTimeout(r, 3000));

    // Find the interaction iframe that contains course list
    const iframeSrc = await browser.js<string>(`
      (() => {
        const f = document.querySelector('iframe[src*="interaction"], iframe[src*="visit/interaction"]');
        return f ? f.src : '';
      })()
    `);

    if (iframeSrc) {
      await browser.goto(iframeSrc);
      await new Promise(r => setTimeout(r, 2000));
    }

    // Extract courses from the interaction page
    const raw = await browser.js<Array<{ id?: string; name?: string; url?: string }>>(`
      (() => {
        const courses = [];
        const links = document.querySelectorAll('a[href*="courseid="]');
        for (const a of links) {
          const name = a.textContent?.trim();
          if (!name || name.length === 0) continue;
          const href = a.href || '';
          const match = href.match(/courseid=(\\d+)/i);
          if (match) {
            courses.push({ id: match[1], name, url: href });
          }
        }
        return courses;
      })()
    `);

    for (const c of raw) {
      if (c.id && c.name) {
        courses.push({ id: c.id, name: c.name, url: c.url ?? '' });
      }
    }
  } catch (e) {
    return {
      errors: [...state.errors, `scan_courses: ${String(e).slice(0, 200)}`],
      phase: 'error',
      courses: [],
    };
  }

  if (courses.length === 0) {
    return {
      errors: [...state.errors, 'scan_courses: 未找到任何课程，请确认已登录超星'],
      phase: 'error',
      courses: [],
    };
  }

  return {
    courses,
    phase: 'enumerating-tasks',
  };
}
