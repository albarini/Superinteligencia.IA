const storefront = new URL('./docs/', location.href);
storefront.search = location.search;
storefront.hash = location.hash;
location.replace(storefront.href);
