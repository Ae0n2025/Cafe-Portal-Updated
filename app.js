(function () {
    const config = {"url": "https://bcugxmojjbpcxqymqikm.supabase.co", "anonKey": "sb_publishable_1dBVxBMpdc-JKja8DCouCQ_yTnnv4-c"};
    const hasUrl = Boolean(config.url);
    const hasAnonKey = Boolean(config.anonKey);
    const configured = hasUrl && hasAnonKey;
    let client;
    let sessionPromise;

    function getClient() {
        if (!configured) return null;
        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            throw new Error('Supabase SDK did not load. Check your internet connection and reload.');
        }
        if (!client) {
            client = window.supabase.createClient(config.url, config.anonKey);
        }
        return client;
    }

    async function getSession() {
        const supabase = getClient();
        if (!supabase) return null;
        if (!sessionPromise) {
            sessionPromise = (async function () {
                const current = await supabase.auth.getSession();
                if (current.error) throw current.error;
                if (!current.data.session || current.data.session.user.is_anonymous) {
                    throw new Error('Please sign in with your account to continue.');
                }
                return current.data.session;
            })().catch(function (error) {
                sessionPromise = null;
                throw error;
            });
        }
        return sessionPromise;
    }

    async function runQuery(query) {
        const result = await query;
        if (result.error) throw result.error;
        return result.data;
    }

    window.CafeBackend = {
        getClient: getClient,
        configured: configured,
        configurationIncomplete: hasUrl !== hasAnonKey,
        async getMenu() {
            if (!configured) return null;
            await getSession();
            return runQuery(
                getClient()
                    .from('menu_items')
                    .select('id, name, description, category, price, image_url')
                    .eq('is_available', true)
                    .order('name')
            );
        },
        async getProfile() {
            if (!configured) return null;
            const session = await getSession();
            return runQuery(
                getClient()
                    .from('profiles')
                    .select('full_name, email, language, dark_mode')
                    .eq('id', session.user.id)
                    .maybeSingle()
            );
        },
        async saveProfile(profile) {
            if (!configured) return false;
            const session = await getSession();
            await runQuery(
                getClient()
                    .from('profiles')
                    .upsert({
                        id: session.user.id,
                        full_name: profile.fullName,
                        email: profile.email || null,
                        language: profile.language,
                        dark_mode: profile.darkMode,
                        updated_at: new Date().toISOString()
                    })
            );
            return true;
        },
        async getOrders() {
            if (!configured) return null;
            const session = await getSession();
            return runQuery(
                getClient()
                    .from('orders')
                    .select('id, order_number, status, payment_method, total, created_at, order_items(item_name, unit_price, quantity)')
                    .eq('customer_id', session.user.id)
                    .order('created_at', { ascending: false })
            );
        },
        async placeOrder(paymentMethod, items) {
            if (!configured) return null;
            await getSession();
            return runQuery(
                getClient().rpc('place_customer_order', {
                    p_payment_method: paymentMethod,
                    p_items: items.map(function (item) {
                        return { product_id: item.id, quantity: item.quantity };
                    })
                })
            );
        },
        async signOut() {
            if (!configured) return;
            const result = await getClient().auth.signOut();
            if (result.error) throw result.error;
            sessionPromise = null;
        }
    };
})();

document.addEventListener('DOMContentLoaded', function () {
    const customerRoot = document.getElementById('customerView');
    const pageDocument = {
        getElementById: function (id) { return customerRoot.querySelector('#' + id); },
        querySelector: function (selector) { return customerRoot.querySelector(selector); },
        querySelectorAll: function (selector) { return customerRoot.querySelectorAll(selector); },
        body: customerRoot
    };
    const storageKeys = {
        cart: 'cafePortal.customer.cart',
        orders: 'cafePortal.customer.orders',
        profile: 'cafePortal.customer.profile',
        preferences: 'cafePortal.customer.preferences'
    };

    function showToast(message) {
        const toast = pageDocument.getElementById('toast');
        toast.textContent = message;
        toast.hidden = false;
        clearTimeout(showToast.timeout);
        showToast.timeout = setTimeout(function () {
            toast.hidden = true;
        }, 3500);
    }

    function readStorage(key, fallback) {
        try {
            const saved = localStorage.getItem(key);
            if (saved === null) return fallback;
            return JSON.parse(saved);
        } catch (error) {
            showToast('Saved browser data could not be read. Starting with an empty value.');
            return fallback;
        }
    }

    function writeStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            showToast('Could not save this change in browser storage.');
            return false;
        }
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[character];
        });
    }

    if (window.lucide) window.lucide.createIcons();

    const contentViews = pageDocument.querySelectorAll('.content-view');
    const navLinks = pageDocument.querySelectorAll('.sidebar-nav .nav-link');
    const productsGrid = pageDocument.getElementById('productsGrid');
    const menuSearchInput = pageDocument.getElementById('menuSearchInput');
    const emptyMenuMessage = pageDocument.getElementById('emptyMenuMessage');
    const cartItemsElement = pageDocument.getElementById('filledCartItems');
    const placeOrderButton = pageDocument.getElementById('placeOrderBtn');
    const historyBody = pageDocument.getElementById('orderHistoryBody');
    const trackingOrders = pageDocument.getElementById('trackingOrders');
    const profileNameInput = pageDocument.getElementById('profileName');
    const profileEmailInput = pageDocument.getElementById('profileEmail');
    const languageSelect = pageDocument.getElementById('languageSelect');
    const backend = window.CafeBackend;

    let activeCategory = 'all';
    let cart = readStorage(storageKeys.cart, []);
    let orders = backend.configured ? [] : readStorage(storageKeys.orders, []);
    let profile = readStorage(storageKeys.profile, {
        fullName: profileNameInput.value,
        email: profileEmailInput.value
    });
    let preferences = readStorage(storageKeys.preferences, { language: 'en', darkMode: false });
    let menuItems = Array.from(productsGrid.querySelectorAll('.product-card')).map(function (card) {
        const button = card.querySelector('.btn-add-item');
        return {
            id: button.dataset.productId,
            name: button.dataset.name,
            price: Number(button.dataset.price),
            category: card.dataset.category,
            description: card.querySelector('.card-desc').textContent.trim(),
            image_url: card.querySelector('img').src
        };
    });

    cart = Array.isArray(cart) ? cart.filter(function (item) {
        return item && typeof item.id === 'string' && Number.isFinite(Number(item.price))
            && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0;
    }).map(function (item) {
        return {
            id: item.id,
            name: String(item.name),
            price: Number(item.price),
            quantity: Math.min(Number(item.quantity), 20)
        };
    }) : [];
    orders = Array.isArray(orders) ? orders : [];

    function saveCart() {
        writeStorage(storageKeys.cart, cart);
    }

    function showView(id) {
        contentViews.forEach(function (view) {
            view.classList.toggle('active', view.id === id);
        });
        navLinks.forEach(function (link) {
            link.classList.toggle('active', link.dataset.view === id);
        });
        if (id === 'viewOrderHistory' || id === 'viewOrderTracking') refreshOrders();
    }

    navLinks.forEach(function (link) {
        link.addEventListener('click', function () {
            showView(link.dataset.view);
        });
    });

    pageDocument.querySelectorAll('.filter-pill').forEach(function (pill) {
        pill.addEventListener('click', function () {
            activeCategory = pill.dataset.category;
            pageDocument.querySelectorAll('.filter-pill').forEach(function (button) {
                button.classList.toggle('active', button === pill);
            });
            filterMenu();
        });
    });

    function filterMenu() {
        const searchTerm = menuSearchInput.value.trim().toLocaleLowerCase();
        let visibleCount = 0;
        productsGrid.querySelectorAll('.product-card').forEach(function (card) {
            const matchesCategory = activeCategory === 'all' || card.dataset.category === activeCategory;
            const matchesSearch = !searchTerm || card.textContent.toLocaleLowerCase().includes(searchTerm);
            const visible = matchesCategory && matchesSearch;
            card.hidden = !visible;
            if (visible) visibleCount += 1;
        });
        emptyMenuMessage.hidden = visibleCount > 0;
    }

    menuSearchInput.addEventListener('input', filterMenu);

    function renderMenu(items) {
        menuItems = items;
        productsGrid.innerHTML = items.map(function (item) {
            const id = escapeHtml(item.id);
            const name = escapeHtml(item.name);
            const description = escapeHtml(item.description || '');
            const category = escapeHtml(item.category);
            const imageUrl = escapeHtml(item.image_url || '');
            const price = Number(item.price);
            return `
                <div class="product-card" data-category="${category}" data-product-id="${id}">
                    <div class="card-image-wrap">
                        ${item.id === 'chicken-teriyaki-bowl' ? '<span class="most-ordered-badge"><i data-lucide="star"></i> MOST ORDERED</span>' : ''}
                        <img src="${imageUrl}" alt="${name}" loading="lazy">
                        <span class="price-tag">₱${price.toFixed(0)}</span>
                    </div>
                    <div class="card-details">
                        <div class="card-title-row">
                            <h3>${name}</h3>
                            <button class="btn-add-item" type="button" data-product-id="${id}" data-name="${name}" data-price="${price}" aria-label="Add ${name} to cart">+</button>
                        </div>
                        <p class="card-desc">${description}</p>
                        <a href="#" class="view-details-link">View item details</a>
                    </div>
                </div>`;
        }).join('');
        if (window.lucide) window.lucide.createIcons();
        filterMenu();
    }

    productsGrid.addEventListener('click', function (event) {
        const addButton = event.target.closest('.btn-add-item');
        if (addButton) {
            const item = menuItems.find(function (menuItem) {
                return menuItem.id === addButton.dataset.productId;
            });
            if (item) addToCart(item);
            return;
        }

        const detailsLink = event.target.closest('.view-details-link');
        if (detailsLink) {
            event.preventDefault();
            const card = detailsLink.closest('.product-card');
            const item = menuItems.find(function (menuItem) {
                return menuItem.id === card.dataset.productId;
            });
            if (item) showProductDetails(item);
        }
    });

    const productDetailsDialog = pageDocument.getElementById('productDetailsDialog');
    let detailItem = null;
    function showProductDetails(item) {
        detailItem = item;
        pageDocument.getElementById('detailsImage').src = item.image_url || '';
        pageDocument.getElementById('detailsImage').alt = item.name;
        pageDocument.getElementById('detailsCategory').textContent = item.category;
        pageDocument.getElementById('detailsName').textContent = item.name;
        pageDocument.getElementById('detailsDescription').textContent = item.description || '';
        pageDocument.getElementById('detailsPrice').textContent = `₱${Number(item.price).toFixed(2)}`;
        productDetailsDialog.showModal();
    }

    pageDocument.getElementById('detailsAddButton').addEventListener('click', function () {
        if (detailItem) addToCart(detailItem);
        productDetailsDialog.close();
    });

    function addToCart(item) {
        const existing = cart.find(function (cartItem) {
            return cartItem.id === item.id;
        });
        if (existing) {
            if (existing.quantity >= 20) {
                showToast('You can add up to 20 of each item.');
                return;
            }
            existing.quantity += 1;
        } else {
            cart.push({
                id: item.id,
                name: item.name,
                price: Number(item.price),
                quantity: 1
            });
        }
        saveCart();
        renderCart();
        showToast(`${item.name} added to your cart.`);
    }

    function renderCart() {
        const itemCount = cart.reduce(function (total, item) {
            return total + item.quantity;
        }, 0);
        const subtotal = cart.reduce(function (total, item) {
            return total + item.price * item.quantity;
        }, 0);

        pageDocument.getElementById('navCartCount').textContent = itemCount;
        pageDocument.getElementById('checkoutItemCount').textContent = itemCount;
        pageDocument.getElementById('checkoutSubtotal').textContent = `₱${subtotal.toFixed(2)}`;
        pageDocument.getElementById('checkoutTotal').textContent = `₱${subtotal.toFixed(2)}`;
        placeOrderButton.disabled = itemCount === 0;
        pageDocument.getElementById('emptyCartBox').hidden = itemCount > 0;
        cartItemsElement.hidden = itemCount === 0;

        cartItemsElement.innerHTML = cart.map(function (item) {
            return `
                <div class="cart-item-row">
                    <div class="cart-item-description">
                        <strong>${escapeHtml(item.name)}</strong>
                        <span>₱${item.price.toFixed(2)} each</span>
                    </div>
                    <div class="cart-item-actions">
                        <button type="button" data-cart-action="decrease" data-product-id="${escapeHtml(item.id)}" aria-label="Decrease ${escapeHtml(item.name)} quantity">−</button>
                        <span>${item.quantity}</span>
                        <button type="button" data-cart-action="increase" data-product-id="${escapeHtml(item.id)}" aria-label="Increase ${escapeHtml(item.name)} quantity">+</button>
                        <button type="button" class="cart-remove-button" data-cart-action="remove" data-product-id="${escapeHtml(item.id)}">Remove</button>
                    </div>
                </div>`;
        }).join('');
    }

    cartItemsElement.addEventListener('click', function (event) {
        const button = event.target.closest('[data-cart-action]');
        if (!button) return;
        const item = cart.find(function (cartItem) {
            return cartItem.id === button.dataset.productId;
        });
        if (!item) return;
        if (button.dataset.cartAction === 'remove' || (button.dataset.cartAction === 'decrease' && item.quantity === 1)) {
            cart = cart.filter(function (cartItem) {
                return cartItem.id !== item.id;
            });
        } else if (button.dataset.cartAction === 'decrease') {
            item.quantity -= 1;
        } else if (button.dataset.cartAction === 'increase') {
            if (item.quantity >= 20) {
                showToast('You can add up to 20 of each item.');
                return;
            }
            item.quantity += 1;
        }
        saveCart();
        renderCart();
    });

    pageDocument.getElementById('openCartBtn').addEventListener('click', function () {
        showView('viewCheckout');
    });
    pageDocument.getElementById('backToMenuBtn').addEventListener('click', function () {
        showView('viewHome');
    });
    pageDocument.getElementById('btnReturnMenu').addEventListener('click', function () {
        showView('viewHome');
    });

    pageDocument.querySelectorAll('.payment-option').forEach(function (option) {
        option.addEventListener('click', function () {
            pageDocument.querySelectorAll('.payment-option').forEach(function (other) {
                other.classList.toggle('active', other === option);
                other.querySelector('input').checked = other === option;
            });
        });
    });

    function formatPayment(method) {
        return {
            cash: 'Cash',
            gcash: 'GCash',
            maya: 'Maya',
            bank: 'Bank transfer'
        }[method] || method;
    }

    function formatStatus(status) {
        return String(status || 'pending').replace(/_/g, ' ');
    }

    function normalizeOrder(order) {
        return {
            id: order.id,
            orderNumber: order.order_number || order.orderNumber,
            status: order.status || 'pending',
            paymentMethod: order.payment_method || order.paymentMethod || 'cash',
            total: Number(order.total) || 0,
            createdAt: order.created_at || order.createdAt || new Date().toISOString(),
            items: (order.order_items || order.items || []).map(function (item) {
                return {
                    name: item.item_name || item.name,
                    price: Number(item.unit_price || item.price) || 0,
                    quantity: Number(item.quantity) || 1
                };
            })
        };
    }

    function renderOrders() {
        const normalizedOrders = orders.map(normalizeOrder);
        pageDocument.getElementById('orderCount').textContent = `${normalizedOrders.length} ORDER${normalizedOrders.length === 1 ? '' : 'S'}`;
        pageDocument.getElementById('emptyHistoryMessage').hidden = normalizedOrders.length > 0;
        historyBody.innerHTML = normalizedOrders.map(function (order) {
            const summary = order.items.map(function (item) {
                return `${item.quantity}× ${escapeHtml(item.name)}`;
            }).join(', ');
            const date = new Date(order.createdAt);
            return `
                <tr>
                    <td class="order-id">${escapeHtml(order.orderNumber)}</td>
                    <td class="order-summary">${summary || 'Order items'}</td>
                    <td>${escapeHtml(date.toLocaleString())}</td>
                    <td><span class="status-badge status-${escapeHtml(order.status)}">${escapeHtml(formatStatus(order.status).toUpperCase())}</span></td>
                    <td class="payment-info">${escapeHtml(formatPayment(order.paymentMethod))} • ₱${order.total.toFixed(2)}</td>
                    <td class="action-col"><button type="button" class="btn-chevron" data-order-number="${escapeHtml(order.orderNumber)}" aria-label="Track ${escapeHtml(order.orderNumber)}"><i data-lucide="chevron-right"></i></button></td>
                </tr>`;
        }).join('');

        const activeOrders = normalizedOrders.filter(function (order) {
            return !['completed', 'cancelled'].includes(order.status);
        });
        pageDocument.getElementById('emptyTrackingMessage').hidden = activeOrders.length > 0;
        trackingOrders.innerHTML = activeOrders.map(function (order) {
            const summary = order.items.map(function (item) {
                return `${item.quantity}× ${escapeHtml(item.name)}`;
            }).join(', ');
            return `
                <article class="tracking-order-card">
                    <div class="tracking-order-heading">
                        <div><span class="section-tag">ORDER</span><h3>${escapeHtml(order.orderNumber)}</h3></div>
                        <span class="status-badge status-${escapeHtml(order.status)}">${escapeHtml(formatStatus(order.status).toUpperCase())}</span>
                    </div>
                    <p>${summary || 'Order items'}</p>
                    <div class="tracking-order-footer">
                        <span>${escapeHtml(new Date(order.createdAt).toLocaleString())}</span>
                        <strong>₱${order.total.toFixed(2)}</strong>
                    </div>
                </article>`;
        }).join('');
        if (window.lucide) window.lucide.createIcons();
    }

    historyBody.addEventListener('click', function (event) {
        const button = event.target.closest('[data-order-number]');
        if (!button) return;
        showView('viewOrderTracking');
    });

    async function refreshOrders() {
        if (!backend.configured) {
            renderOrders();
            return;
        }
        try {
            const result = await backend.getOrders();
            orders = result || [];
            renderOrders();
        } catch (error) {
            showToast(`Could not load orders: ${error.message}`);
            renderOrders();
        }
    }

    placeOrderButton.addEventListener('click', async function () {
        if (cart.length === 0) return;
        const paymentMethod = pageDocument.querySelector('input[name="payment"]:checked').value;
        placeOrderButton.disabled = true;
        placeOrderButton.textContent = 'Placing order…';
        try {
            const savedOrder = await backend.placeOrder(paymentMethod, cart);
            if (savedOrder) {
                orders.unshift(Object.assign({}, savedOrder, {
                    order_items: cart.map(function (item) {
                        return {
                            item_name: item.name,
                            unit_price: item.price,
                            quantity: item.quantity
                        };
                    })
                }));
                renderOrders();
            } else {
                const now = new Date().toISOString();
                const localOrder = {
                    order_number: `CP-${String(Date.now()).slice(-6)}`,
                    status: 'pending',
                    payment_method: paymentMethod,
                    total: cart.reduce(function (sum, item) {
                        return sum + item.price * item.quantity;
                    }, 0),
                    created_at: now,
                    order_items: cart.map(function (item) {
                        return {
                            item_name: item.name,
                            unit_price: item.price,
                            quantity: item.quantity
                        };
                    })
                };
                orders.unshift(localOrder);
                writeStorage(storageKeys.orders, orders);
                renderOrders();
            }
            cart = [];
            saveCart();
            renderCart();
            showView('viewOrderTracking');
            showToast('Your order has been placed.');
        } catch (error) {
            showToast(`Could not place order: ${error.message}`);
        } finally {
            placeOrderButton.innerHTML = 'Place order <i data-lucide="chevron-right"></i>';
            renderCart();
            if (window.lucide) window.lucide.createIcons();
        }
    });

    function applyProfile() {
        profileNameInput.value = profile.fullName || 'Alex Rivera';
        profileEmailInput.value = profile.email || '';
        pageDocument.querySelectorAll('.js-user-name').forEach(function (element) {
            element.textContent = profile.fullName || 'Alex Rivera';
        });
        pageDocument.getElementById('greetingTag').textContent = `GOOD MORNING, ${(profile.fullName || 'Alex Rivera').split(/\s+/)[0].toUpperCase()}`;
        const initials = (profile.fullName || 'Alex Rivera').trim().split(/\s+/).slice(0, 2)
            .map(function (part) { return part.charAt(0); }).join('').toUpperCase();
        const avatar = pageDocument.getElementById('profileAvatar');
        if (profile.photo) {
            avatar.innerHTML = `<img src="${escapeHtml(profile.photo)}" alt="Profile photo">`;
        } else {
            avatar.textContent = initials;
        }
    }

    pageDocument.querySelectorAll('.settings-tab-btn').forEach(function (button) {
        button.addEventListener('click', function () {
            pageDocument.querySelectorAll('.settings-tab-btn').forEach(function (tab) {
                tab.classList.toggle('active', tab === button);
            });
            pageDocument.querySelectorAll('.settings-pane').forEach(function (pane) {
                pane.classList.toggle('active', pane.id === button.dataset.settingsTab);
            });
        });
    });

    function savePreferences() {
        preferences.language = languageSelect.value;
        preferences.darkMode = pageDocument.body.classList.contains('dark-mode');
        writeStorage(storageKeys.preferences, preferences);
        profile.language = preferences.language;
        profile.darkMode = preferences.darkMode;
        writeStorage(storageKeys.profile, profile);
        if (backend.configured) {
            backend.saveProfile({
                fullName: profile.fullName || profileNameInput.value,
                email: profile.email || profileEmailInput.value,
                language: preferences.language,
                darkMode: preferences.darkMode
            }).catch(function (error) {
                showToast(`Could not save preferences to Supabase: ${error.message}`);
            });
        }
    }

    pageDocument.getElementById('btnLightMode').addEventListener('click', function () {
        pageDocument.body.classList.remove('dark-mode');
        pageDocument.getElementById('btnLightMode').classList.add('active');
        pageDocument.getElementById('btnDarkMode').classList.remove('active');
        savePreferences();
    });
    pageDocument.getElementById('btnDarkMode').addEventListener('click', function () {
        pageDocument.body.classList.add('dark-mode');
        pageDocument.getElementById('btnDarkMode').classList.add('active');
        pageDocument.getElementById('btnLightMode').classList.remove('active');
        savePreferences();
    });
    languageSelect.addEventListener('change', savePreferences);

    pageDocument.getElementById('profileForm').addEventListener('submit', async function (event) {
        event.preventDefault();
        profile.fullName = profileNameInput.value.trim();
        profile.email = profileEmailInput.value.trim();
        profile.language = languageSelect.value;
        profile.darkMode = pageDocument.body.classList.contains('dark-mode');
        writeStorage(storageKeys.profile, profile);
        applyProfile();
        if (backend.configured) {
            try {
                await backend.saveProfile(profile);
            } catch (error) {
                showToast(`Profile saved in this browser, but Supabase returned an error: ${error.message}`);
                return;
            }
        }
        showToast('Profile saved.');
    });

    const photoInput = pageDocument.getElementById('profilePhotoInput');
    pageDocument.getElementById('changePhotoBtn').addEventListener('click', function () {
        photoInput.click();
    });
    photoInput.addEventListener('change', function () {
        const file = photoInput.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
            showToast('Choose an image smaller than 2 MB.');
            photoInput.value = '';
            return;
        }
        const reader = new FileReader();
        reader.addEventListener('load', function () {
            profile.photo = reader.result;
            if (writeStorage(storageKeys.profile, profile)) {
                applyProfile();
                showToast('Profile photo updated in this browser.');
            }
        });
        reader.addEventListener('error', function () {
            showToast('Could not read that image.');
        });
        reader.readAsDataURL(file);
    });

    async function logOut() {
        if (!window.confirm('Sign out of this customer session?')) return;
        try {
            await backend.signOut();
            window.CafeApp.showLogin();
        } catch (error) {
            showToast(`Could not sign out: ${error.message}`);
        }
    }
    pageDocument.getElementById('headerLogoutBtn').addEventListener('click', logOut);
    pageDocument.getElementById('settingsLogoutBtn').addEventListener('click', logOut);

    async function initializeBackend() {
        function applyPreferenceButtons() {
            pageDocument.getElementById('btnDarkMode').classList.toggle('active', preferences.darkMode);
            pageDocument.getElementById('btnLightMode').classList.toggle('active', !preferences.darkMode);
        }

        languageSelect.value = preferences.language === 'fil' ? 'fil' : 'en';
        pageDocument.body.classList.toggle('dark-mode', Boolean(preferences.darkMode));
        applyPreferenceButtons();
        applyProfile();
        renderCart();
        renderOrders();

        if (!backend.configured) {
            showToast(backend.configurationIncomplete
                ? 'Add both the Supabase URL and publishable key in app.js.'
                : 'Add your Supabase URL and publishable key in app.js to enable the backend.');
            return;
        }

        const results = await Promise.allSettled([
            backend.getMenu(),
            backend.getProfile(),
            backend.getOrders()
        ]);
        if (results[0].status === 'fulfilled' && results[0].value) {
            renderMenu(results[0].value);
        } else if (results[0].status === 'rejected') {
            showToast(`Could not load the Supabase menu: ${results[0].reason.message}`);
        }
        if (results[1].status === 'fulfilled' && results[1].value) {
            profile = Object.assign({}, profile, {
                fullName: results[1].value.full_name,
                email: results[1].value.email || ''
            });
            preferences = Object.assign({}, preferences, {
                language: results[1].value.language || preferences.language,
                darkMode: Boolean(results[1].value.dark_mode)
            });
            languageSelect.value = preferences.language;
            pageDocument.body.classList.toggle('dark-mode', preferences.darkMode);
            applyPreferenceButtons();
            applyProfile();
            writeStorage(storageKeys.profile, profile);
            writeStorage(storageKeys.preferences, preferences);
        } else if (results[1].status === 'rejected') {
            showToast(`Could not load your Supabase profile: ${results[1].reason.message}`);
        }
        if (results[2].status === 'fulfilled') {
            orders = results[2].value || [];
            renderOrders();
        } else {
            showToast(`Could not load Supabase orders: ${results[2].reason.message}`);
        }
    }

    window.CafeApp.initializeCustomer = initializeBackend;
});

/* Student Note: Run scripts when DOM tree is ready */
document.addEventListener('DOMContentLoaded', () => {
    const staffRoot = document.getElementById('staffView');
    const pageDocument = {
        getElementById: function (id) { return staffRoot.querySelector('#' + id); },
        querySelector: function (selector) { return staffRoot.querySelector(selector); },
        querySelectorAll: function (selector) { return staffRoot.querySelectorAll(selector); }
    };

    // Initialize Lucide Vector Icons
    lucide.createIcons();

    // ================= 1. SIDEBAR MAIN VIEW SWITCHING =================
    const navLinks = pageDocument.querySelectorAll('.sidebar-nav .nav-link');
    const contentViews = pageDocument.querySelectorAll('.content-view');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const targetViewId = link.getAttribute('data-view');

            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            contentViews.forEach(view => {
                view.classList.remove('active');
                if (view.id === targetViewId) {
                    view.classList.add('active');
                }
            });
        });
    });

    // ================= 2. PROFILE SETTINGS INNER TAB SWITCHING =================
    const settingsTabBtns = pageDocument.querySelectorAll('.settings-tab-btn');
    const settingsPanes = pageDocument.querySelectorAll('.settings-pane');

    settingsTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');

            settingsTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            settingsPanes.forEach(pane => {
                pane.classList.remove('active');
                if (pane.id === targetTab) {
                    pane.classList.add('active');
                }
            });
        });
    });

    // ================= 3. MENU MODALS INTERACTIVITY =================
    const editItemModal = pageDocument.getElementById('editItemModal');
    const addItemModal = pageDocument.getElementById('addItemModal');

    // Open Edit Modal
    const btnSmEdits = pageDocument.querySelectorAll('.btn-sm-edit');
    btnSmEdits.forEach(btn => {
        btn.addEventListener('click', () => {
            editItemModal.classList.add('active');
        });
    });

    // Open Add Item Modal
    const btnOpenAddModal = pageDocument.getElementById('btnOpenAddModal');
    btnOpenAddModal.addEventListener('click', () => {
        addItemModal.classList.add('active');
    });

    // Close Modals
    pageDocument.getElementById('btnCloseEditModal').addEventListener('click', () => {
        editItemModal.classList.remove('active');
    });

    pageDocument.getElementById('btnCancelEdit').addEventListener('click', () => {
        editItemModal.classList.remove('active');
    });

    pageDocument.getElementById('btnCloseAddModal').addEventListener('click', () => {
        addItemModal.classList.remove('active');
    });

    pageDocument.getElementById('btnCancelAdd').addEventListener('click', () => {
        addItemModal.classList.remove('active');
    });

});

window.CafeApp = window.CafeApp || {};
(function () {
    const loginView = document.getElementById('loginView');
    const customerView = document.getElementById('customerView');
    const staffView = document.getElementById('staffView');
    const customerCard = document.getElementById('customerCard');
    const staffCard = document.getElementById('staffCard');
    const customerMessage = document.getElementById('customerAuthMessage');
    const customerSignUpMessage = document.getElementById('customerSignUpMessage');
    const staffMessage = document.getElementById('staffAuthMessage');
    let supabase;

    function setMessage(element, message, kind) {
        if (!element) return;
        element.textContent = message || '';
        element.classList.toggle('success', kind === 'success');
    }

    function showView(name) {
        loginView.hidden = name !== 'login';
        customerView.hidden = name !== 'customer';
        staffView.hidden = name !== 'staff';
        document.body.dataset.portalView = name;
    }

    function clearCustomerStorage() {
        ['cafePortal.customer.cart', 'cafePortal.customer.orders', 'cafePortal.customer.profile', 'cafePortal.customer.preferences']
            .forEach(function (key) { localStorage.removeItem(key); });
    }

    function setRole(role) {
        const customer = role === 'customer';
        document.getElementById('btnCustomerRole').classList.toggle('active', customer);
        document.getElementById('btnStaffRole').classList.toggle('active', !customer);
        customerCard.style.display = customer ? 'block' : 'none';
        staffCard.style.display = customer ? 'none' : 'block';
        document.getElementById('footerDynamicNote').textContent = customer
            ? 'Use your customer email and password, or create a customer account.'
            : 'Staff sign-in is available only to accounts approved by a portal administrator.';
        setMessage(customerMessage, '', '');
        setMessage(customerSignUpMessage, '', '');
        setMessage(staffMessage, '', '');
    }

    function setCustomerMode(mode) {
        const signingIn = mode === 'signin';
        document.getElementById('customerSignInMode').classList.toggle('active', signingIn);
        document.getElementById('customerSignUpMode').classList.toggle('active', !signingIn);
        document.getElementById('customerSignInView').classList.toggle('active', signingIn);
        document.getElementById('customerSignUpView').classList.toggle('active', !signingIn);
        setMessage(customerMessage, '', '');
        setMessage(customerSignUpMessage, '', '');
        if (window.lucide) window.lucide.createIcons();
    }

    function setBusy(form, busy, busyText) {
        const button = form.querySelector('button[type="submit"]');
        if (!button) return;
        if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
        button.disabled = busy;
        button.textContent = busy ? busyText : button.dataset.idleText;
    }

    async function findStaffMembership(user) {
        const result = await supabase
            .from('staff_members')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle();
        if (result.error) throw result.error;
        return Boolean(result.data);
    }

    function openCustomer(user) {
        showView('customer');
        if (user && user.email) {
            customerView.querySelectorAll('.js-user-name').forEach(function (node) {
                if (!node.textContent || node.textContent === 'Alex Rivera') node.textContent = user.email;
            });
        }
        if (typeof window.CafeApp.initializeCustomer === 'function') {
            window.CafeApp.initializeCustomer();
        }
    }

    function openStaff(user) {
        const name = user.user_metadata && user.user_metadata.full_name
            ? user.user_metadata.full_name
            : user.email;
        const nameNode = staffView.querySelector('.user-name');
        if (nameNode) nameNode.textContent = name || 'Staff';
        showView('staff');
    }

    async function signIn(form, role) {
        const email = form.querySelector('input[type="email"]').value.trim();
        const password = form.querySelector('input[type="password"]').value;
        const message = role === 'staff' ? staffMessage : customerMessage;
        setMessage(message, '', '');
        setBusy(form, true, 'Signing in...');
        try {
            const result = await supabase.auth.signInWithPassword({ email: email, password: password });
            if (result.error) throw result.error;
            if (role === 'staff') {
                let isStaff;
                try {
                    isStaff = await findStaffMembership(result.data.user);
                } catch (error) {
                    const signOut = await supabase.auth.signOut();
                    if (signOut.error) throw signOut.error;
                    throw error;
                }
                if (!isStaff) {
                    const signOut = await supabase.auth.signOut();
                    if (signOut.error) throw signOut.error;
                    throw new Error('This account is not approved for staff access. Contact a portal administrator.');
                }
                openStaff(result.data.user);
            } else {
                openCustomer(result.data.user);
            }
        } catch (error) {
            setMessage(message, error.message || 'Sign-in failed. Please try again.');
        } finally {
            setBusy(form, false);
        }
    }

    async function signUp(form) {
        const fullName = form.querySelector('[name="fullName"]').value.trim();
        const email = form.querySelector('input[type="email"]').value.trim();
        const password = form.querySelector('[name="password"]').value;
        const confirmPassword = form.querySelector('[name="confirmPassword"]').value;
        setMessage(customerSignUpMessage, '', '');
        if (password !== confirmPassword) {
            setMessage(customerSignUpMessage, 'Passwords do not match.');
            return;
        }
        setBusy(form, true, 'Creating account...');
        try {
            const result = await supabase.auth.signUp({
                email: email,
                password: password,
                options: { data: { full_name: fullName } }
            });
            if (result.error) throw result.error;
            if (!result.data.session) {
                setMessage(customerSignUpMessage, 'Check your email to confirm your account, then sign in.', 'success');
                form.reset();
                return;
            }
            openCustomer(result.data.user);
        } catch (error) {
            setMessage(customerSignUpMessage, error.message || 'Could not create the account.');
        } finally {
            setBusy(form, false);
        }
    }

    async function sendPasswordReset(form, message) {
        const email = form.querySelector('input[type="email"]').value.trim();
        if (!email) {
            setMessage(message, 'Enter your email address first.');
            return;
        }
        try {
            const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
            if (result.error) throw result.error;
            setMessage(message, 'If this email has an account, a password reset link will be sent.', 'success');
        } catch (error) {
            setMessage(message, error.message || 'Could not send the password reset email.');
        }
    }

    window.CafeApp.showLogin = function () {
        clearCustomerStorage();
        setRole('customer');
        setCustomerMode('signin');
        showView('login');
    };

    window.CafeApp.signOut = async function () {
        const result = await window.CafeBackend.signOut();
        if (result && result.error) throw result.error;
        window.CafeApp.showLogin();
    };

    document.addEventListener('DOMContentLoaded', async function () {
        if (window.lucide) window.lucide.createIcons();
        document.getElementById('btnCustomerRole').addEventListener('click', function () { setRole('customer'); });
        document.getElementById('btnStaffRole').addEventListener('click', function () { setRole('staff'); });
        document.getElementById('customerSignInMode').addEventListener('click', function () { setCustomerMode('signin'); });
        document.getElementById('customerSignUpMode').addEventListener('click', function () { setCustomerMode('signup'); });

        document.getElementById('customerSignInForm').addEventListener('submit', function (event) {
            event.preventDefault();
            signIn(event.currentTarget, 'customer');
        });
        document.getElementById('customerSignUpForm').addEventListener('submit', function (event) {
            event.preventDefault();
            signUp(event.currentTarget);
        });
        document.getElementById('staffSignInForm').addEventListener('submit', function (event) {
            event.preventDefault();
            signIn(event.currentTarget, 'staff');
        });
        document.getElementById('customerForgotPassword').addEventListener('click', function (event) {
            event.preventDefault();
            sendPasswordReset(document.getElementById('customerSignInForm'), customerMessage);
        });
        document.getElementById('staffForgotPassword').addEventListener('click', function (event) {
            event.preventDefault();
            sendPasswordReset(document.getElementById('staffSignInForm'), staffMessage);
        });
        document.addEventListener('click', function (event) {
            const icon = event.target.closest('.toggle-password');
            if (!icon) return;
            const input = icon.parentElement.querySelector('input[type="password"], input[type="text"]');
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
            icon.setAttribute('data-lucide', input.type === 'password' ? 'eye' : 'eye-off');
            if (window.lucide) window.lucide.createIcons();
        });
        document.getElementById('staffLogoutBtn').addEventListener('click', async function () {
            if (!window.confirm('Sign out of the staff portal?')) return;
            try {
                await window.CafeApp.signOut();
            } catch (error) {
                setMessage(staffMessage, 'Could not sign out: ' + error.message);
            }
        });

        showView('login');
        try {
            supabase = window.CafeBackend.getClient();
            const current = await supabase.auth.getSession();
            if (current.error) throw current.error;
            const user = current.data.session && current.data.session.user;
            if (!user) return;
            if (user.is_anonymous) {
                const signOut = await supabase.auth.signOut();
                if (signOut.error) throw signOut.error;
                return;
            }
            const isStaff = await findStaffMembership(user);
            if (isStaff) openStaff(user);
            else openCustomer(user);
        } catch (error) {
            setMessage(customerMessage, error.message || 'Could not initialize Supabase authentication.');
        }
    });
})();
