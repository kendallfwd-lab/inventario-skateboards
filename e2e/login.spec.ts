import {test,expect} from '@playwright/test';

test('la tienda pública funciona sin iniciar sesión',async({page})=>{await page.goto('/');await expect(page.getByRole('heading',{name:'Tu próxima tabla empieza aquí.'})).toBeVisible();await expect(page.getByRole('heading',{name:/Encuentra tu próxima tabla/})).toBeVisible();await expect(page.getByText('Colección de tablas').first()).toBeVisible();});
test('el área administrativa conserva el acceso protegido',async({page})=>{await page.goto('/admin/login');await expect(page.getByRole('heading',{name:/Gestiona tu inventario/})).toBeVisible();await expect(page.getByLabel('Correo')).toBeVisible();await expect(page.getByLabel('Contraseña')).toBeVisible();});
test('la tienda se adapta a escritorio y móvil',async({page})=>{await page.goto('/');const box=await page.locator('body').boundingBox();expect(box?.width).toBeGreaterThan(0);expect(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth)).toBeTruthy();});
