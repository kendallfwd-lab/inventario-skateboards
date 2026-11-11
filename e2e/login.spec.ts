import {test,expect} from '@playwright/test';

const checkoutProduct={variantId:1,name:'Deck E2E',size:'8.0',price:30000,stock:5,sku:'TEST-E2E',slug:'deck-e2e',featured:true,description:'Tabla de prueba',collectionName:'Demo',productType:'DECK',threshold:1};

test.beforeEach(async({page})=>{
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/store/products**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([checkoutProduct])}));
});
test('la tienda pública funciona sin iniciar sesión',async({page})=>{await page.goto('/');await expect(page.getByRole('heading',{name:'Tu próxima tabla empieza aquí.'})).toBeVisible();await expect(page.getByRole('heading',{name:/Encuentra tu próxima tabla/})).toBeVisible();await expect(page.getByText('Colección de tablas').first()).toBeVisible();});
test('la página baja de forma natural al recorrer la tienda',async({page})=>{
  await page.goto('/');
  const collection=page.locator('.collection-track');
  await collection.scrollIntoViewIfNeeded();
  await collection.hover();
  const initial=await page.evaluate(()=>window.scrollY);
  await page.mouse.wheel(0,700);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(initial);
  const firstScroll=await page.evaluate(()=>window.scrollY);
  await page.mouse.wheel(0,700);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(firstScroll);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBeTruthy();
});
test('el catálogo se recupera al reintentar después de una falla de API',async({page})=>{
  let catalogUnavailable=true;
  await page.route('**/api/store/products**',route=>catalogUnavailable
    ?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'API temporalmente no disponible'})})
    :route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([checkoutProduct])}));
  await page.goto('/');
  const alert=page.getByRole('alert');
  await expect(alert).toContainText('No se pudo cargar el catálogo.');
  catalogUnavailable=false;
  await alert.getByRole('button',{name:'Reintentar'}).click();
  await expect(page.getByRole('heading',{name:'Deck E2E'})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('el área administrativa conserva el acceso protegido',async({page})=>{await page.goto('/admin/login');await expect(page.getByRole('heading',{name:/Gestiona tu inventario/})).toBeVisible();await expect(page.getByLabel('Correo')).toBeVisible();await expect(page.getByLabel('Contraseña')).toBeVisible();});
test('la tienda se adapta a escritorio y móvil',async({page})=>{await page.goto('/');const box=await page.locator('body').boundingBox();expect(box?.width).toBeGreaterThan(0);expect(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth)).toBeTruthy();});
test('el checkout permite aplicar un código de promoción',async({page})=>{await page.goto('/');await page.locator('.product-card .button').first().click();await page.getByRole('button',{name:'Abrir carrito'}).click();await page.getByRole('button',{name:/Solicitar pedido/}).click();await expect(page.getByLabel('Código promocional')).toBeVisible();await expect(page.getByRole('button',{name:'Aplicar código'})).toBeVisible();});
test('checkout confirma el descuento y envía el código al crear el pedido',async({page})=>{
  let orderPayload:Record<string,unknown>|null=null;
  await page.route('**/api/store/promotions/validate',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'SKATE10',name:'Descuento de prueba',subtotal:30000,discount:3000,total:27000})}));
  await page.route('**/api/store/orders',async route=>{
    orderPayload=route.request().postDataJSON() as Record<string,unknown>;
    await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({reference:'SK-TEST-1',total:27000,discount:3000})});
  });
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('/');
  await page.locator('.product-card .button').first().click();
  await page.getByRole('button',{name:'Abrir carrito'}).click();
  await page.getByRole('button',{name:/Solicitar pedido/}).click();
  await page.getByLabel('Código promocional').fill('skate10');
  await page.getByRole('button',{name:'Aplicar código'}).click();
  await expect(page.getByText('Total con promoción:')).toBeVisible();
  await page.getByLabel('Nombre completo').fill('Cliente E2E');
  await page.getByLabel('Correo o teléfono').fill('cliente-e2e@example.test');
  await page.getByLabel('Datos de entrega').fill('Entrega de prueba para validar el checkout');
  const submit=page.getByRole('button',{name:'Enviar solicitud'});
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  await expect.poll(()=>orderPayload).not.toBeNull();
  expect(orderPayload?.promotionCode).toBe('SKATE10');
  await expect(page.getByText('Solicitud enviada. Revisaremos tu pedido.')).toBeVisible();
});
test('checkout bloquea el pedido cuando el código promocional no es válido',async({page})=>{
  let orderSubmitted=false;
  await page.route('**/api/store/promotions/validate',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:'El código promocional no es válido'})}));
  await page.route('**/api/store/orders',route=>{orderSubmitted=true;return route.fulfill({status:201,contentType:'application/json',body:'{}'});});
  await page.goto('/');
  await page.locator('.product-card .button').first().click();
  await page.getByRole('button',{name:'Abrir carrito'}).click();
  await page.getByRole('button',{name:/Solicitar pedido/}).click();
  await page.getByLabel('Código promocional').fill('INVALIDO');
  await page.getByRole('button',{name:'Aplicar código'}).click();
  await expect(page.getByRole('alert')).toHaveText('El código promocional no es válido');
  await expect(page.getByRole('button',{name:'Enviar solicitud'})).toBeDisabled();
  expect(orderSubmitted).toBe(false);
});
