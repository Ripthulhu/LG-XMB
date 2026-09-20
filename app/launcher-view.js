/* SPDX-License-Identifier: GPL-3.0-or-later */
// Retained launcher DOM. Rebuild membership only when IDs change; navigation
// updates row offsets in place. No TV service calls or animation-frame layout reads.
(function (root) {
  'use strict';
  function LauncherView(options) {
    var categories = options.categories,
      selections = options.selections;
    var $ = function (id) {
      return document.getElementById(id);
    };
    var detailIcon = null,
      renderedCategory = -1;
    function detail(item) {
      // Labels can change while the selected physical input stays the same.
      if ($('detailType').textContent !== item.type) $('detailType').textContent = item.type;
      if ($('detailTitle').textContent !== item.title) $('detailTitle').textContent = item.title;
      if ($('detailDescription').textContent !== item.description)
        $('detailDescription').textContent = item.description;
      if (detailIcon !== item.icon) {
        $('detailEmblem').innerHTML = C5Icon(item.icon);
        detailIcon = item.icon;
      }

      $('previewButton').setAttribute('aria-label', 'Open ' + item.title + ' full-screen');
    }
    function buildCategories() {
      var nav = $('categories');
      categories.forEach(function (cat, index) {
        var b = document.createElement('button');
        b.className = 'category';
        b.style.transform =
          'translateX(calc(-50% + ' + index * LGXMBCategoryTransition.DISTANCE + 'vw))';
        b.setAttribute('aria-label', cat.title);
        b.setAttribute('data-category', cat.id);
        var face =
          '<span class="category-icon">' +
          C5Icon(cat.icon) +
          '</span><span class="category-label"></span>';
        b.innerHTML =
          '<span class="face dim">' +
          face +
          '</span><span class="face lit" aria-hidden="true">' +
          face +
          '<i class="category-dot"></i></span>';
        [].forEach.call(b.querySelectorAll('.category-label'), function (label) {
          label.textContent = cat.title;
        });
        b.addEventListener('click', function () {
          if (!options.isBusy()) options.selectCategory(index);
        });
        nav.appendChild(b);
      });
    }
    // Retain painted category rows off-screen so switching categories can move
    // existing layers instead of rebuilding and rasterising their text.
    var itemButtons = new WeakMap(),
      itemOffsets = new WeakMap(),
      itemLists = [],
      itemListKeys = [],
      activeCategory = -1;
    function buildItems() {
      var selectedCategory = options.getCategory();
      var list = $('items');
      list.setAttribute('aria-label', categories[selectedCategory].title);
      categories.forEach(function (cat, ci) {
        var wrap = itemLists[ci],
          key = cat.items
            .map(function (item) {
              return item.id;
            })
            .join('|');
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.className = 'rows';
          wrap.setAttribute('role', 'none');
          wrap.setAttribute('data-category', cat.id);
          list.appendChild(wrap);
          itemLists[ci] = wrap;
        }
        if (itemListKeys[ci] !== key) {
          wrap.textContent = '';
          cat.items.forEach(function (item) {
            var b = itemButtons.get(item);
            if (!b) {
              b = document.createElement('button');
              b.className = 'item';
              b.setAttribute('role', 'option');
              b.setAttribute('data-item', item.id);
              b.tabIndex = -1;
              b.innerHTML =
                '<span class="item-icon">' +
                C5Icon(item.icon) +
                '</span><span class="item-text"></span>';
              b.addEventListener('click', function () {
                if (!options.canActivate()) return;
                options.cancelHold();
                var selectedCategory = options.getCategory();
                var current = categories[selectedCategory].items.indexOf(item);
                if (current < 0) return;
                options.activateItem(current);
              });
              itemButtons.set(item, b);
            }
            itemOffsets.delete(b);
            wrap.appendChild(b);
          });
          itemListKeys[ci] = key;
        }
        var active = ci === selectedCategory;
        if (wrap.classList.contains('parked') === active) {
          wrap.classList.toggle('parked', !active);
          wrap.setAttribute('aria-hidden', active ? 'false' : 'true');
        }
        [].forEach.call(wrap.children, function (b, index) {
          var item = cat.items[index],
            id = active ? 'item-' + index : '';
          // Only the active list owns the item-N ids the listbox points at.
          if (b.id !== id) {
            if (id) b.id = id;
            else b.removeAttribute('id');
          }
          // Input labels may have refreshed since this row was last built.
          if (b.getAttribute('aria-label') !== item.title) {
            b.setAttribute('aria-label', item.title);
            b.querySelector('.item-text').textContent = item.title;
          }
        });
        // A parked list is kept in its remembered state, so showing it changes nothing.
        if (!active) renderRows(ci);
      });
      activeCategory = selectedCategory;
    }
    // Membership changes go through buildItems. A category move only touches
    // the two lists changing roles; the other retained lists stay untouched.
    function activateCategory() {
      var next = options.getCategory();
      if (next === activeCategory) return;
      var previous = itemLists[activeCategory],
        current = itemLists[next];
      if (previous) {
        previous.classList.add('parked');
        previous.setAttribute('aria-hidden', 'true');
        [].forEach.call(previous.children, function (button) {
          button.removeAttribute('id');
        });
      }
      current.classList.remove('parked');
      current.setAttribute('aria-hidden', 'false');
      $('items').setAttribute('aria-label', categories[next].title);
      [].forEach.call(current.children, function (button, index) {
        button.id = 'item-' + index;
        var title = categories[next].items[index].title;
        if (button.getAttribute('aria-label') !== title) {
          button.setAttribute('aria-label', title);
          button.querySelector('.item-text').textContent = title;
        }
      });
      activeCategory = next;
    }
    function render() {
      var selectedCategory = options.getCategory();
      var index = selections[selectedCategory];
      // Up/down does not change the horizontal bar. Leave its styles, accessibility
      // attributes and any in-flight CSS transition alone.
      if (renderedCategory !== selectedCategory) {
        $('categories').style.transform =
          'translate3d(' + -selectedCategory * LGXMBCategoryTransition.DISTANCE + 'vw,0,0)';
        [].forEach.call($('categories').children, function (button, i) {
          var offset = i - selectedCategory;
          button.classList.toggle('active', offset === 0);
          // Dim through colour alpha, not element opacity: on the C5 a change to
          // a text element's opacity cost a dropped frame per key press, colour
          // is a plain repaint. Never transition it, that repaints every frame.
          button.setAttribute('aria-current', offset === 0 ? 'true' : 'false');
          button.tabIndex = offset === 0 ? 0 : -1;
        });
        renderedCategory = selectedCategory;
      }
      renderRows(selectedCategory);
      var active = 'item-' + index;
      if ($('items').getAttribute('aria-activedescendant') !== active)
        $('items').setAttribute('aria-activedescendant', active);
    }
    function menuObjects() {
      var selectedCategory = options.getCategory();
      var out = [],
        index = selections[selectedCategory],
        rows = categories[selectedCategory].items.length;
      categories.forEach(function (cat, i) {
        out.push({
          id: 'c' + i,
          x: (31 + (i - selectedCategory) * LGXMBCategoryTransition.DISTANCE) / 50 - 1,
          y: 1 - 32.6 / 50
        });
      });
      for (var i = Math.max(0, index - 3); i <= Math.min(rows - 1, index + 3); i++) {
        var offset = i - index;
        out.push({
          id: 'r' + selectedCategory + ':' + i,
          x: 31 / 50 - 1,
          y: 1 - (52 + offset * 8.4 - (offset < 0 ? 25 : 0) + 3.25) / 50
        });
      }
      return out;
    }
    function renderRows(ci) {
      var index = selections[ci];
      [].forEach.call(itemLists[ci] ? itemLists[ci].children : [], function (button, i) {
        var offset = i - index,
          previous = itemOffsets.get(button);
        if (previous === offset) return;
        var first = previous === undefined,
          visible = offset >= -3 && offset <= 3;
        button.style.setProperty('--item-y', offset * 8.4 - (offset < 0 ? 25 : 0) + 'vh');
        if (first || previous < 0 !== offset < 0) button.classList.toggle('above-bar', offset < 0);
        if (first || (previous === 0) !== (offset === 0)) {
          button.classList.toggle('selected', offset === 0);
          button.setAttribute('aria-selected', offset === 0 ? 'true' : 'false');
        }
        if (first || visible !== (previous >= -3 && previous <= 3)) {
          button.style.visibility = visible ? 'visible' : 'hidden';
          button.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
        var itemAlpha = !visible ? '0' : offset === 0 ? '1' : '.5';
        if (button.style.getPropertyValue('--item-alpha') !== itemAlpha)
          button.style.setProperty('--item-alpha', itemAlpha);
        itemOffsets.set(button, offset);
      });
    }

    function updateItemLabel(category, index, item) {
      var list = itemLists[category],
        button = list && list.children[index];
      if (!button) return;
      button.querySelector('.item-text').textContent = item.title;
      button.setAttribute('aria-label', item.title);
    }
    return {
      buildCategories: buildCategories,
      buildItems: buildItems,
      activateCategory: activateCategory,
      render: render,
      renderRows: renderRows,
      detail: detail,
      menuObjects: menuObjects,
      updateItemLabel: updateItemLabel
    };
  }
  root.LGXMBLauncherView = LauncherView;
})(window);
