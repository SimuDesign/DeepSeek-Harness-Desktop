/**
 * dsh-plugin-file-upload — browser client half.
 *
 * Adds a paperclip button to the composer tool row (`conversation.input.left`
 * slot). Picking files:
 *
 *   - image MIME (per the host `imageLimits` projection) → routed through the
 *     conversation attachment seam (`createDraftImages` + `addImages`) so it
 *     lands in the existing draft-image rail and sends as a vision block;
 *   - everything else → read as text (FileReader) and appended to the draft
 *     as a fenced code block with a language hint from the file extension.
 *
 * The feature is browser-only (the host half is a no-op). Session scoping
 * rides the slot `inject` seam — the same pattern as ui-conversation's own
 * QueueDock — so the API key and the filesystem never leave the machine.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-file-upload',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');

    /** Top safety guard against reading absurdly large files into memory. */
    var MAX_READ_BYTES = 16 * 1024 * 1024;
    /** Ceiling on the draft after an insert. */
    var MAX_DRAFT_CHARS = 1000000;

    function isImageType(type, mediaTypes) {
      return mediaTypes
        ? mediaTypes.indexOf(type) !== -1
        : /^image\//.test(type || '');
    }

    var LANG_BY_EXT = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
      ts: 'typescript', mts: 'typescript', tsx: 'tsx',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
      c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp',
      sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ps1: 'powershell',
      json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
      html: 'html', css: 'css', md: 'markdown', txt: 'text', sql: 'sql',
    };

    function guessLanguage(name) {
      var ext = String(name || '').split('.').pop().toLowerCase();
      return LANG_BY_EXT[ext] || '';
    }

    /** True when the decoded text looks like binary (NUL bytes, control-char or replacement-char clusters). */
    function looksBinary(text) {
      var sample = String(text || '').slice(0, 65536);
      if (sample.indexOf('\u0000') !== -1) return true;
      var n = sample.length;
      if (n === 0) return false;
      var odd = 0;
      for (var i = 0; i < n; i += 1) {
        var c = sample.charCodeAt(i);
        if (c === 0xFFFD || (c < 32 && c !== 9 && c !== 10 && c !== 13)) odd += 1;
      }
      return odd / n > 0.02;
    }

    /**
     * Binary (non-text) file: nothing to insert as content, but the desktop
     * shell's preload can reveal the real path — hand that to the agent
     * instead, so it can read the file with its own fs/tool stack.
     * @returns true when a path reference was inserted.
     */
    function insertBinaryPath(file, currentDraft, setDraft) {
      var getPath = window.dshDesktop && typeof window.dshDesktop.getPathForFile === 'function'
        ? window.dshDesktop.getPathForFile
        : undefined;
      if (typeof getPath !== 'function') return false;
      var path = null;
      try { path = getPath(file); } catch (err) { return false; }
      if (!path) return false;
      var line = separatorFor(currentDraft) + '📎 文件：`' + path + '`（二进制/非文本，请用工具读取）\n';
      var next = (currentDraft + line).slice(0, MAX_DRAFT_CHARS);
      if (typeof setDraft === 'function') setDraft(next);
      return true;
    }

    /**
     * Separator between the existing draft and an inserted block: nothing on
     * an empty draft, one blank line otherwise — never stacks blank lines.
     */
    function separatorFor(draft) {
      if (!draft || draft.trim() === '') return '';
      if (draft.endsWith('\n\n')) return '';
      if (draft.endsWith('\n')) return '\n';
      return '\n\n';
    }

    function FileUploadButton(props) {
      var useProjection = props.useProjection;
      var input = props.input || {};
      var imageIds = input.imageIds || [];
      var imageLimits = typeof useProjection === 'function' ? useProjection('imageLimits') : undefined;
      var inputRef = React.useRef(null);
      // Always the latest rendered draft, so async FileReader loads append
      // onto the freshest text instead of a stale snapshot.
      var draftRef = React.useRef(input.draft || '');
      draftRef.current = input.draft || '';

      var noticeState = React.useState(null);
      var notice = noticeState[0];
      var setNotice = noticeState[1];

      function showNotice(text) {
        if (typeof props.notify === 'function') {
          props.notify('info', text);
          return;
        }
        setNotice(text);
        window.setTimeout(function () {
          setNotice(function (cur) { return cur === text ? null : cur; });
        }, 4000);
      }

      function addImages(files) {
        if (typeof props.createDraftImages !== 'function') {
          showNotice('附件服务不可用');
          return;
        }
        var limits = imageLimits;
        if (limits) {
          if (limits.maxImagesPerMessage !== undefined
            && imageIds.length + files.length > limits.maxImagesPerMessage) {
            showNotice('图片数量超限（最多 ' + String(limits.maxImagesPerMessage) + ' 张）');
            return;
          }
          if (limits.maxImageBytes !== undefined
            && files.some(function (f) { return f.size > limits.maxImageBytes; })) {
            showNotice('单张图片超过大小限制');
            return;
          }
          var incoming = files.reduce(function (sum, f) { return sum + f.size; }, 0);
          if (limits.maxMessageImageBytes !== undefined && incoming > limits.maxMessageImageBytes) {
            showNotice('图片总大小超过限制');
            return;
          }
        }
        var attachments;
        try {
          attachments = props.createDraftImages(files);
        } catch (err) {
          showNotice('图片格式不支持或读取失败');
          return;
        }
        if (!attachments || attachments.length === 0) return;
        if (typeof props.addImages === 'function') {
          props.addImages(attachments.map(function (a) { return a.id; }));
        }
      }

      /** Read text files one at a time, appending each block onto the running draft. */
      function appendTextFiles(texts, index, currentDraft) {
        if (index >= texts.length) return;
        var file = texts[index];
        if (file.size > MAX_READ_BYTES) {
          showNotice('文件过大（>16MB），未插入: ' + file.name);
          appendTextFiles(texts, index + 1, currentDraft);
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var text = String(reader.result || '');
          if (looksBinary(text)) {
            if (!insertBinaryPath(file, currentDraft, props.setDraft)) {
              showNotice('二进制文件，无法以文本插入: ' + file.name);
            }
            appendTextFiles(texts, index + 1, currentDraft);
            return;
          }
          // Escape any triple-backtick so the inserted block cannot break out.
          var escaped = text.replace(/```/g, '`\u200b``');
          var block = separatorFor(currentDraft) + '```' + guessLanguage(file.name) + '\n' + escaped + '\n```\n';
          var next = currentDraft + block;
          if (next.length > MAX_DRAFT_CHARS) {
            showNotice('内容过长（草稿上限 100 万字符），已截断到上限');
            next = next.slice(0, MAX_DRAFT_CHARS);
          }
          if (typeof props.setDraft === 'function') props.setDraft(next);
          appendTextFiles(texts, index + 1, next);
        };
        reader.onerror = function () {
          showNotice('文件读取失败: ' + file.name);
          appendTextFiles(texts, index + 1, currentDraft);
        };
        reader.readAsText(file);
      }

      function handleChange(event) {
        var files = event.target.files;
        if (!files || files.length === 0) return;
        var mediaTypes = imageLimits && imageLimits.mediaTypes;
        var images = [];
        var texts = [];
        for (var i = 0; i < files.length; i += 1) {
          var file = files[i];
          if (isImageType(file.type, mediaTypes)) {
            images.push(file);
          } else if (/^image\//.test(file.type || '')) {
            // image/* outside the host-accepted mediaTypes: refuse instead of
            // reading binary as text into the draft.
            showNotice('不支持的图片格式: ' + file.name);
          } else {
            texts.push(file);
          }
        }
        if (images.length > 0) addImages(images);
        if (texts.length > 0) appendTextFiles(texts, 0, draftRef.current);
        event.target.value = ''; // re-selecting the same file re-fires change
      }

      var buttonStyle = {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, padding: 0, borderRadius: 8, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 14, lineHeight: 1,
      };

      return React.createElement(React.Fragment, null,
        React.createElement('input', {
          ref: inputRef, type: 'file', multiple: true,
          style: { display: 'none' },
          onChange: handleChange,
        }),
        React.createElement('button', {
          type: 'button', style: buttonStyle, title: '上传文件：图片走附件，文本/代码插入草稿',
          disabled: typeof props.setDraft !== 'function' && typeof props.addImages !== 'function',
          onClick: function () { if (inputRef.current) inputRef.current.click(); },
        }, '\uD83D\uDCCE'),
        notice !== null && React.createElement('span', {
          style: { marginLeft: 6, fontSize: 12, color: 'var(--dsw-alias-danger-default, #e5484d)' },
        }, notice)
      );
    }

    exports.name = 'dsh-plugin-file-upload';
    exports.inject = [];
    exports.apply = function (ctx) {
      var slots = ctx.get('slots');
      if (slots === undefined) return;
      slots.inject('conversation.input.left', function () {
        return slots.register({
          name: 'conversation.input.left',
          id: 'file-upload',
          order: 5,
          label: '上传文件',
          inject: function (sessionId) {
            var sessions = ctx.get('sessions');
            if (sessions === undefined) throw new Error('dsh-plugin-file-upload: sessions service unavailable');
            var actx = sessions.scope(sessionId);
            if (actx === undefined) throw new Error('dsh-plugin-file-upload: session "' + sessionId + '" resolved no scope');
            var conversation = actx.get('conversation');
            if (conversation === undefined) throw new Error('dsh-plugin-file-upload: conversation service unavailable');
            var input = conversation.input.for(actx);
            return {
              createDraftImages: function (files) { return conversation.createDraftImages(files); },
              addImages: function (ids) { return input.addImages(ids); },
              setDraft: function (text) { input.setDraft(text); },
              notify: function (level, text) { input.notify(level, text); },
            };
          },
        }, FileUploadButton);
      });
    };

    // The loader takes the factory's RETURN value as the plugin exports.
    return exports;
  },
});
