(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const searchInput = document.getElementById('search-input');
  const optCase = document.getElementById('opt-case');
  const optWholeWord = document.getElementById('opt-whole-word');
  const optMultiWord = document.getElementById('opt-multi-word');
  const optProximity = document.getElementById('opt-proximity');
  const optProximityLines = document.getElementById('opt-proximity-lines');
  const proximitySection = document.getElementById('proximity-section');
  const btnSearch = document.getElementById('btn-search');
  const btnBack = document.getElementById('btn-back');
  const btnForward = document.getElementById('btn-forward');
  const btnCancel = document.getElementById('btn-cancel');
  const progressDiv = document.getElementById('progress');
  const progressText = document.getElementById('progress-text');
  const resultsSummary = document.getElementById('results-summary');
  const resultsDiv = document.getElementById('results');

  // Toggle proximity section visibility
  optMultiWord.addEventListener('change', function () {
    proximitySection.style.display = optMultiWord.checked ? 'flex' : 'none';
    if (!optMultiWord.checked) {
      optProximity.checked = false;
    }
  });

  // Search on Enter
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      doSearch();
    }
  });

  btnSearch.addEventListener('click', doSearch);

  btnBack.addEventListener('click', function () {
    vscode.postMessage({ command: 'back' });
  });

  btnForward.addEventListener('click', function () {
    vscode.postMessage({ command: 'forward' });
  });

  btnCancel.addEventListener('click', function () {
    vscode.postMessage({ command: 'cancel' });
    progressDiv.style.display = 'none';
  });

  function doSearch() {
    const query = searchInput.value.trim();
    if (!query) { return; }

    vscode.postMessage({
      command: 'search',
      query: query,
      caseSensitive: optCase.checked,
      wholeWord: optWholeWord.checked,
      proximityEnabled: optMultiWord.checked && optProximity.checked,
      proximityLines: parseInt(optProximityLines.value, 10) || 1,
    });
  }

  // Handle messages from extension
  window.addEventListener('message', function (event) {
    const message = event.data;

    switch (message.command) {
      case 'searchStarted':
        progressDiv.style.display = 'flex';
        progressText.textContent = 'Searching...';
        resultsSummary.style.display = 'none';
        resultsDiv.innerHTML = '';
        break;

      case 'progress':
        progressText.textContent = message.message;
        break;

      case 'results':
        progressDiv.style.display = 'none';
        renderResults(message.data, message.totalFiles);
        updateNavButtons(message.canBack, message.canForward);
        break;

      case 'restoreState':
        restoreState(message.state);
        updateNavButtons(message.canBack, message.canForward);
        break;

      case 'error':
        progressDiv.style.display = 'none';
        resultsDiv.innerHTML = '<div class="error-message">' + escapeHtml(message.message) + '</div>';
        resultsSummary.style.display = 'none';
        break;

      case 'clear':
        progressDiv.style.display = 'none';
        resultsDiv.innerHTML = '';
        resultsSummary.style.display = 'none';
        break;
    }
  });

  function updateNavButtons(canBack, canForward) {
    btnBack.disabled = !canBack;
    btnForward.disabled = !canForward;
  }

  function restoreState(state) {
    searchInput.value = state.query;
    optCase.checked = state.caseSensitive;
    optWholeWord.checked = state.wholeWord;
    optMultiWord.checked = state.multiWord;
    optProximity.checked = state.proximityEnabled;
    optProximityLines.value = state.proximityLines;
    proximitySection.style.display = state.multiWord ? 'flex' : 'none';
    renderResults(state.results, state.results.length);
  }

  function renderResults(results, totalFiles) {
    resultsDiv.innerHTML = '';

    if (totalFiles === 0) {
      resultsSummary.style.display = 'block';
      resultsSummary.textContent = 'No results found. At least 2 words must match in a file.';
      return;
    }

    resultsSummary.style.display = 'block';
    resultsSummary.textContent = totalFiles + ' file' + (totalFiles !== 1 ? 's' : '') + ' found';

    for (var i = 0; i < results.length; i++) {
      var fileMatch = results[i];
      resultsDiv.appendChild(createFileGroup(fileMatch));
    }
  }

  function createFileGroup(fileMatch) {
    var group = document.createElement('div');
    group.className = 'file-group';

    // Parse filename from URI
    var parts = fileMatch.uriString.split('/');
    var filename = parts[parts.length - 1];
    var dirPath = getRelativePath(fileMatch.uriString);

    // File header
    var header = document.createElement('div');
    header.className = 'file-header';

    var arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '\u25B6';

    var badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = fileMatch.matchedWordCount + '/' + fileMatch.totalWords;

    var nameSpan = document.createElement('span');
    nameSpan.className = 'filename';
    nameSpan.textContent = filename;

    var pathSpan = document.createElement('span');
    pathSpan.className = 'filepath';
    pathSpan.textContent = dirPath;

    header.appendChild(arrow);
    header.appendChild(badge);
    header.appendChild(nameSpan);
    header.appendChild(pathSpan);

    // Matches container
    var matches = document.createElement('div');
    matches.className = 'file-matches';

    // Span info
    if (fileMatch.smallestSpan < Infinity) {
      var spanInfo = document.createElement('div');
      spanInfo.className = 'span-info';
      if (fileMatch.smallestSpan === 0) {
        spanInfo.textContent = 'Best match: words on same line (line ' + (fileMatch.bestSpanStart + 1) + ')';
      } else {
        spanInfo.textContent = 'Best match: span of ' + (fileMatch.smallestSpan + 1) +
          ' lines (lines ' + (fileMatch.bestSpanStart + 1) + '-' + (fileMatch.bestSpanEnd + 1) + ')';
      }
      matches.appendChild(spanInfo);
    }

    // Group occurrences by line number and deduplicate
    var lineMap = {};
    for (var j = 0; j < fileMatch.occurrences.length; j++) {
      var occ = fileMatch.occurrences[j];
      if (!lineMap[occ.lineNumber]) {
        lineMap[occ.lineNumber] = [];
      }
      if (lineMap[occ.lineNumber].indexOf(occ.word) === -1) {
        lineMap[occ.lineNumber].push(occ.word);
      }
    }

    var lineNums = Object.keys(lineMap).map(Number).sort(function (a, b) { return a - b; });
    for (var k = 0; k < lineNums.length; k++) {
      var lineNum = lineNums[k];
      var words = lineMap[lineNum];

      var matchLine = document.createElement('div');
      matchLine.className = 'match-line';
      matchLine.setAttribute('data-uri', fileMatch.uriString);
      matchLine.setAttribute('data-line', lineNum.toString());

      var lineNumSpan = document.createElement('span');
      lineNumSpan.className = 'line-num';
      lineNumSpan.textContent = 'Line ' + (lineNum + 1);

      matchLine.appendChild(lineNumSpan);
      matchLine.appendChild(document.createTextNode(words.join(', ')));

      matchLine.addEventListener('click', function () {
        var uri = this.getAttribute('data-uri');
        var line = parseInt(this.getAttribute('data-line'), 10);
        vscode.postMessage({ command: 'openFile', uri: uri, line: line });
      });

      matches.appendChild(matchLine);
    }

    // Toggle expand/collapse
    header.addEventListener('click', function () {
      var isExpanded = matches.classList.contains('expanded');
      if (isExpanded) {
        matches.classList.remove('expanded');
        arrow.textContent = '\u25B6';
      } else {
        matches.classList.add('expanded');
        arrow.textContent = '\u25BC';
      }
    });

    // Click on header also opens file at best span
    header.addEventListener('dblclick', function () {
      vscode.postMessage({
        command: 'openFile',
        uri: fileMatch.uriString,
        line: fileMatch.bestSpanStart,
      });
    });

    group.appendChild(header);
    group.appendChild(matches);
    return group;
  }

  function getRelativePath(uriString) {
    // Try to extract a readable path
    try {
      var decoded = decodeURIComponent(uriString);
      // Remove scheme
      var path = decoded.replace(/^[a-z-]+:\/\//, '');
      // Get directory part
      var lastSlash = path.lastIndexOf('/');
      if (lastSlash >= 0) {
        return path.substring(0, lastSlash);
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
