import type { OrchestratorState, TaskItem } from '../state';
import type { BrowserClient } from '../browser';

export async function enumerateTasks(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  if (state.courses.length === 0) {
    return { tasks: [], phase: 'done' };
  }

  const { BrowserClient } = await import('../browser');
  const browser = new BrowserClient();
  const tasks: TaskItem[] = [];

  // Process first course (one at a time to avoid session issues)
  const course = state.courses[state.currentCourseIndex];
  if (!course) {
    return { tasks: [], phase: 'done' };
  }

  try {
    // Navigate to course homework page
    const courseUrl = `https://mooc1.chaoxing.com/mycourse/studentcourse?courseId=${course.id}`;
    await browser.goto(courseUrl);
    await new Promise(r => setTimeout(r, 3000));

    // Extract chapter and task list
    const rawTasks = await browser.js<Array<{
      chapterName?: string;
      title?: string;
      url?: string;
      status?: string;
      workId?: string;
    }>>(`
      (() => {
        const results = [];
        const chapters = document.querySelectorAll('.chapter_td, .chapter_item, .catalog_item, [class*="chapter"]');

        for (const ch of chapters) {
          const chName = ch.querySelector('.chapter_name, .catalog_title, .catalog_name, [class*="chapter_name"]')?.textContent?.trim() || '';
          const items = ch.querySelectorAll('a[href*="workId"], a[href*="/work/"], a[href*="dowork"], .jobUnFinish, [class*="job"]');

          for (const item of items) {
            const title = (item.querySelector('.jobTitle, .job_name, [class*="jobName"]') || item).textContent?.trim() || '';
            const href = item.href || item.querySelector('a')?.href || '';
            const icon = item.querySelector('.jobUnFinish, .jobFinish, .status-finish, [class*="status"]');
            const statusText = icon?.classList?.toString()?.includes('Finish') ? 'done' : 'pending';

            if (href && href.includes('work')) {
              results.push({
                chapterName: chName,
                title: title || chName,
                url: href,
                status: statusText,
                workId: href.match(/workId=(\\d+)/)?.[1],
              });
            }
          }
        }

        // Fallback: scan all links on the page
        if (results.length === 0) {
          document.querySelectorAll('a[href*="workId"]').forEach(a => {
            results.push({
              chapterName: '',
              title: a.textContent?.trim() || '',
              url: a.href,
              status: 'pending',
              workId: a.href.match(/workId=(\\d+)/)?.[1],
            });
          });
        }

        return results;
      })()
    `);

    for (const t of rawTasks) {
      if (t.url && t.status !== 'done') {
        tasks.push({
          id: t.workId ?? `task-${tasks.length}`,
          courseId: course.id,
          courseName: course.name,
          chapterName: t.chapterName ?? '',
          title: t.title ?? '',
          url: t.url,
          status: 'pending',
        });
      }
    }
  } catch (e) {
    return {
      errors: [...state.errors, `enumerate_tasks: ${String(e)}`],
      tasks: [],
      phase: 'processing',
    };
  }

  return {
    tasks,
    phase: 'processing',
    summary: {
      ...state.summary,
      total: tasks.length,
      pending: tasks.length,
    },
  };
}
