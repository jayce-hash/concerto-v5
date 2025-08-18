// timeline-renderer.js
export function fmtTime(d){
  try{
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
  }catch{
    const h = d.getHours();
    const m = d.getMinutes().toString().padStart(2,'0');
    const ampm = h >= 12 ? "PM":"AM";
    const hh = ((h % 12) || 12);
    return `${hh}:${m} ${ampm}`;
  }
}

export function renderTimeline(items, container){
  container.innerHTML = '';
  const ul = document.createElement('ul');
  ul.style.listStyle = 'none';
  ul.style.padding = '0';
  ul.style.margin = '0';

  items.forEach(it => {
    const li = document.createElement('li');
    li.style.borderLeft = '2px solid var(--navy)';
    li.style.padding = '12px 16px 12px 18px';
    li.style.position = 'relative';
    li.style.marginLeft = '10px';

    const dot = document.createElement('span');
    dot.style.position = 'absolute';
    dot.style.left = '-7px';
    dot.style.top = '20px';
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.background = 'var(--snow)';
    dot.style.opacity = (it.type==='anchor') ? '1' : '.9';
    li.appendChild(dot);

    const time = document.createElement('div');
    time.textContent = `${fmtTime(it.start)}${it.type==='note' ? '' : ' – ' + fmtTime(it.end)}`;
    time.style.opacity = '.8';
    time.style.fontVariantNumeric = 'tabular-nums';

    const h = document.createElement('div');
    h.textContent = it.title;
    h.style.fontFamily = "'Cormorant Garamond', serif";
    h.style.textTransform = 'uppercase';
    h.style.letterSpacing = '.04em';
    h.style.margin = '4px 0 2px';

    const p = document.createElement('div');
    p.textContent = it.details || '';

    li.append(time, h, p);
    ul.appendChild(li);
  });

  container.appendChild(ul);
}