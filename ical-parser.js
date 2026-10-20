/**
 * Client-Side iCal Parser tuned for Canvas and BYU Learning Suite feeds & .ics files.
 */
(function (global) {
  'use strict';

  function unescapeIcalText(text) {
    if (!text) return '';
    return String(text)
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/gi, '\n');
  }

  function parseIcalDate(dateStr) {
    if (!dateStr) return null;
    // Strip property params (e.g. DTSTART;VALUE=DATE:20260922)
    const val = dateStr.includes(':') ? dateStr.split(':').pop().trim() : dateStr.trim();
    if (!val) return null;

    // Format: YYYYMMDDTHHMMSSZ or YYYYMMDD
    const match = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!match) return null;

    const [, year, month, day, hour, min, sec, isUtc] = match;
    if (hour !== undefined) {
      if (isUtc) {
        return new Date(Date.UTC(+year, +month - 1, +day, +hour, +min, +sec));
      } else {
        return new Date(+year, +month - 1, +day, +hour, +min, +sec);
      }
    } else {
      // Date only
      return new Date(+year, +month - 1, +day);
    }
  }

  function getCalendarName(rawIcal) {
    if (!rawIcal) return null;
    const match = rawIcal.match(/(?:X-WR-CALNAME|WR-CALNAME)(?:;[^:]*)?:(.+)/i);
    return match ? unescapeIcalText(match[1].trim()) : null;
  }

  function generateAssignmentHash(source, courseName, title, dueDate) {
    const normSource = (source || '').toLowerCase().trim();
    const normCourse = (courseName || '').toLowerCase().trim();
    const normTitle = (title || '').toLowerCase().trim().replace(/\s*\[.+?\]$/, '');
    const normDue = dueDate ? new Date(dueDate).toISOString().slice(0, 10) : 'nodue';
    return `hash_${normSource}_${normCourse}_${normTitle}_${normDue}`.replace(/[^a-z0-9_]/gi, '_');
  }

  function isLikelyNonAssignment(summary, description, rrule, dtEnd, dtStart) {
    const text = ((summary || '') + ' ' + (description || '')).toLowerCase();
    
    // Recurring events like daily/weekly classes
    if (rrule) return true;

    // Common non-assignment event keywords
    const lectureKeywords = [
      'lecture', 'office hour', 'recitation', 'lab session', 
      'no class', 'holiday', 'break', 'orientation', 'no school'
    ];
    for (const kw of lectureKeywords) {
      if (text.includes(kw)) return true;
    }

    // Event with start and end times lasting <= 2 hours (typical class meeting) and no assignment keywords
    if (dtStart && dtEnd) {
      const diffMinutes = (dtEnd.getTime() - dtStart.getTime()) / (1000 * 60);
      const isAssignmentKeyword = /assignment|homework|quiz|exam|paper|project|essay|submit|turn in|due|lab \d+/i.test(text);
      if (diffMinutes > 0 && diffMinutes <= 120 && !isAssignmentKeyword) {
        return true;
      }
    }

    return false;
  }

  function parseIcalContent(rawIcal, defaultSource = 'Upload') {
    const calendarName = getCalendarName(rawIcal);
    const events = [];
    
    // Unfold multi-line folded headers in iCal (lines ending with CRLF + space/tab)
    const unfolded = rawIcal.replace(/\r?\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);

    let inEvent = false;
    let currentEvent = {};

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line === 'BEGIN:VEVENT') {
        inEvent = true;
        currentEvent = {};
        continue;
      }

      if (line === 'END:VEVENT') {
        if (inEvent) {
          events.push(currentEvent);
        }
        inEvent = false;
        continue;
      }

      if (!inEvent) continue;

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const propHeader = line.slice(0, colonIdx);
      const val = line.slice(colonIdx + 1);

      const propParts = propHeader.split(';');
      const propName = propParts[0].toUpperCase();
      const propParams = propParts.slice(1);

      if (propName === 'SUMMARY') {
        currentEvent.summary = unescapeIcalText(val);
      } else if (propName === 'DESCRIPTION') {
        currentEvent.description = unescapeIcalText(val);
      } else if (propName === 'UID') {
        currentEvent.uid = val.trim();
      } else if (propName === 'URL') {
        currentEvent.url = val.trim();
      } else if (propName === 'DTSTART') {
        currentEvent.dtstartRaw = val;
        currentEvent.dtstart = parseIcalDate(line);
      } else if (propName === 'DTEND') {
        currentEvent.dtendRaw = val;
        currentEvent.dtend = parseIcalDate(line);
        currentEvent.hasExplicitDtend = true;
        if (propParams.some(p => p.toUpperCase().includes('VALUE=DATE'))) {
          currentEvent.isDateOnlyEnd = true;
        }
      } else if (propName === 'RRULE') {
        currentEvent.rrule = val;
      }
    }

    // Determine platform (Canvas vs Learning Suite vs Generic)
    const isCanvas = rawIcal.includes('instructure.com') || events.some(e => e.url && e.url.includes('instructure.com'));
    const isLS = rawIcal.includes('learningsuite.byu.edu') || rawIcal.includes('ctl.byu.edu') || (calendarName && calendarName.includes('Learning Suite'));
    const detectedSource = isCanvas ? 'Canvas' : (isLS ? 'Learning Suite' : defaultSource);

    const assignments = [];

    for (const e of events) {
      if (!e.summary) continue;

      // Extract Course Name
      let courseName = calendarName || 'General';
      const bracketMatch = e.summary.match(/\[(.+?)\]$/);
      if (bracketMatch) {
        courseName = bracketMatch[1];
      }

      // Check for non-assignment lecture clutter
      if (isLikelyNonAssignment(e.summary, e.description, e.rrule, e.dtend, e.dtstart)) {
        continue;
      }

      // Determine Due Date & Deep Link
      let due = null;
      let hasNoDueDate = false;
      let deepUrl = e.url || null;

      if (detectedSource === 'Canvas') {
        // Canvas uses DTEND or DTSTART as the assignment due date
        due = e.dtend || e.dtstart || null;
        hasNoDueDate = !due;
        if (e.url) {
          const match = e.url.match(/course_(\d+).*#assignment_(\d+)/);
          if (match) {
            deepUrl = `https://byu.instructure.com/courses/${match[1]}/assignments/${match[2]}`;
          }
        }
      } else if (detectedSource === 'Learning Suite') {
        // Learning Suite: DTSTART is item open time. DTEND is actual due date!
        if (e.hasExplicitDtend && e.dtend) {
          due = new Date(e.dtend);
          if (e.isDateOnlyEnd) {
            due.setDate(due.getDate() - 1);
          }
          hasNoDueDate = false;
        } else if (e.dtstart) {
          const summary = (e.summary || '').replace(/\s*\[.+?\]$/, '').trim();
          const isShortTitle = summary.length <= 60;
          const hasAssignmentKeyword = /homework|\bhw\b|assignment|quiz|exam|paper|project|essay|test|submit|turn in|lab \d+/i.test(summary);
          const isDescriptiveNotice = /typically|takes more time|good idea|remember to|note:|announcement|make sure to/i.test(summary);

          due = new Date(e.dtstart);
          if (isShortTitle && hasAssignmentKeyword && !isDescriptiveNotice) {
            // Concise single-date assignment title (e.g. "Homework 6", "HW 9b")
            hasNoDueDate = false;
          } else {
            // Long class description note (e.g. "HW 9b typically takes more time..."), reading, or undated entry
            hasNoDueDate = true;
          }
        } else {
          due = null;
          hasNoDueDate = true;
        }





        // LS UID format: [ID]@ctl.byu.edu
        if (e.uid) {
          const match = e.uid.match(/([A-Za-z0-9]+)@ctl\.byu\.edu$/);
          if (match) {
            const lsCourseId = match[1].slice(-12);
            const encodedTitle = encodeURIComponent(e.summary.replace(/\s*\[.+?\]$/, ''));
            deepUrl = `https://learningsuite.byu.edu/cid-${lsCourseId}/student/home/assignments#${encodedTitle}`;
          }
        }
      } else {
        // Generic source
        due = e.dtend || e.dtstart || null;
        hasNoDueDate = !due;
      }

      const dueIso = due ? due.toISOString() : null;

      // Clean Title
      const cleanTitle = e.summary.replace(/\s*\[.+?\]$/, '').trim();

      const hash = generateAssignmentHash(detectedSource, courseName, cleanTitle, dueIso);

      assignments.push({
        id: hash,
        title: cleanTitle,
        rawTitle: e.summary,
        courseName,
        due: dueIso,
        hasNoDueDate: hasNoDueDate,
        hasNoDates: hasNoDueDate,
        source: detectedSource,
        url: deepUrl,
        description: e.description || '',
        isDone: false
      });
    }

    return {
      calendarName,
      source: detectedSource,
      assignments
    };
  }

  global.IcalParser = {
    parseIcalContent,
    generateAssignmentHash
  };

})(typeof window !== 'undefined' ? window : globalThis);
