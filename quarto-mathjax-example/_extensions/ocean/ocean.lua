--[[ Ocean for Quarto: Ocean's slide structure from plain Quarto Markdown.

  ## Title {kicker="Method"}     a content slide: kicker, title, .slide-body, footer
  # Part one                     a divider (.section-slide): number, title, text, logo
  ## Thank You {.closing-slide}  the closing slide: title, text (::: contact), logo
  {.no-foot}                     a content slide without the footer

  The footer (authors · institute, short title, slide number, logo) is written into the HTML here, so it is part
  of the deck PinDeck sees. Speaker notes and ::: refs stay outside .slide-body: they are placed on the slide.
  Metadata: short-title (default: title), short-authors (default: the authors), institute, event (title slide).
]]

local stringify = pandoc.utils.stringify

local function esc(s)
  return (s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"))
end

local function has(el, class)
  for _, c in ipairs(el.classes) do if c == class then return true end end
  return false
end

local function names(meta)
  local out = {}
  for _, a in ipairs(meta["by-author"] or {}) do
    local n = a.name and (a.name.literal or a.name)
    if n then out[#out + 1] = stringify(n) end
  end
  if #out == 0 and meta.author then
    local a = meta.author
    if type(a) == "table" and a[1] and type(a[1]) == "table" and a[1].t ~= "Str" then
      for _, x in ipairs(a) do out[#out + 1] = stringify(x.name or x) end
    else out[1] = stringify(a) end
  end
  return table.concat(out, ", ")
end

local function institute(meta)
  local i = meta.institute
  if not i then return "" end
  if type(i) == "table" and i[1] and type(i[1]) == "table" and i[1].t == nil then
    local out = {}
    for _, x in ipairs(i) do out[#out + 1] = stringify(x) end
    return table.concat(out, ", ")
  end
  return stringify(i)
end

function Pandoc(doc)
  local meta = doc.meta
  -- where this extension is, as the rendered HTML (next to the source) reaches it
  local docdir = pandoc.path.directory(quarto.doc.input_file)
  local dir = pandoc.path.make_relative(pandoc.path.directory(quarto.utils.resolve_path("ocean.lua")), docdir)
  dir = dir:gsub("\\", "/")
  meta["ocean-dir"] = dir
  local inst = institute(meta)
  meta["ocean-institute"] = inst
  local authors = meta["short-authors"] and stringify(meta["short-authors"]) or names(meta)
  local short = stringify(meta["short-title"] or meta.title or "")
  local left = esc(authors) .. (inst ~= "" and " · " .. esc(inst) or "")

  local out, n, part = {}, 1, 0          -- the title slide is slide 1
  local head, body, aside = nil, {}, {}
  local started = false

  local function raw(html) return pandoc.RawBlock("html", html) end
  local function flush()
    if not started then
      for _, b in ipairs(body) do out[#out + 1] = b end
      body = {}
      return
    end
    local h = head and head.t == "Header" and head or nil   -- nil: a slide started by --- (no title)
    local hidden = h and h.attributes.visibility == "hidden"
    if not hidden then n = n + 1 end
    local kind = "content"
    if h and h.level == 1 then kind = "section"
    elseif h and has(h, "closing-slide") then kind = "closing" end
    if head then out[#out + 1] = head end   -- the heading (or ---) that starts the slide
    if kind == "content" then
      local kicker = h and h.attributes.kicker
      if kicker then
        h.attributes.kicker = nil
        out[#out + 1] = pandoc.Div(pandoc.Plain(pandoc.Str(kicker)), pandoc.Attr("", { "kicker" }))
      end
      out[#out + 1] = pandoc.Div(body, pandoc.Attr("", { "slide-body" }))
      for _, b in ipairs(aside) do out[#out + 1] = b end
      if not (h and has(h, "no-foot")) then
        out[#out + 1] = raw('<footer class="slide-foot"><div class="f-left">' .. left .. '</div>' ..
          '<div class="f-mid">' .. esc(short) .. '</div>' ..
          '<div class="f-num">' .. (hidden and "–" or string.format("%02d", n)) .. '</div>' ..
          '<img class="f-logo" src="' .. dir .. '/assets/logo-placeholder-dark.svg" alt=""></footer>')
      end
    else
      if kind == "section" then
        part = part + 1
        out[#out + 1] = pandoc.Div(pandoc.Plain(pandoc.Str(string.format("%02d", part))), pandoc.Attr("", { "num" }))
      end
      for _, b in ipairs(body) do out[#out + 1] = b end
      for _, b in ipairs(aside) do out[#out + 1] = b end
      out[#out + 1] = raw('<img class="logo" src="' .. dir .. '/assets/logo-placeholder-light.svg" alt="Logo">')
    end
    head, body, aside = nil, {}, {}
  end

  for _, b in ipairs(doc.blocks) do
    if b.t == "Header" and b.level <= 2 then
      flush()
      started = true
      if b.level == 1 and not has(b, "section-slide") then b.classes:insert("section-slide") end
      head = b
    elseif b.t == "HorizontalRule" then
      flush()
      started = true
      head = b
    elseif b.t == "Div" and (has(b, "notes") or has(b, "refs")) then
      aside[#aside + 1] = b
    else
      body[#body + 1] = b
    end
  end
  flush()
  doc.blocks = out
  return doc
end
