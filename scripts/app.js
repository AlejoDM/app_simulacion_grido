// Archivo: scripts/app.js
// IMPORTANTE: Este archivo NO usa 'import React' porque React ya está
// cargado globalmente (en window) desde el index.html.

const { useState, useEffect } = React;

// --- CONFIGURACIÓN DE ALMACENAMIENTO LOCAL ---
const STORAGE_KEY_DATA = 'simulationQueueDataV3_Data';
const STORAGE_KEY_STATS = 'simulationQueueDataV3_Stats';

// --- Funciones de Carga/Guardado de Datos (Registros) ---
const loadLocalData = () => {
    try {
        const data = localStorage.getItem(STORAGE_KEY_DATA);
        const entries = data ? JSON.parse(data) : [];
        return entries.sort((a, b) => b.arrivalTimestamp - a.arrivalTimestamp);
    } catch (e) { console.error("Error al cargar datos:", e); return []; }
};

const saveLocalData = (data) => {
    try {
        localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(data));
    } catch (e) { console.error("Error al guardar datos:", e); }
};

// --- Funciones de Carga/Guardado de Estadísticas (Máximos) ---
const loadLocalStats = () => {
    try {
        const stats = localStorage.getItem(STORAGE_KEY_STATS);
        return stats ? JSON.parse(stats) : { maxCashierQueue: 0, maxPrepQueue: 0 };
    } catch (e) { console.error("Error al cargar stats:", e); return { maxCashierQueue: 0, maxPrepQueue: 0 }; }
};

const saveLocalStats = (stats) => {
    try {
        localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats));
    } catch (e) { console.error("Error al guardar stats:", e); }
};

// --- Helper: Formato de Duración ---
const formatDuration = (ms) => {
    if (ms === null || isNaN(ms) || ms < 0) return '00:00:00.000';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    const milliseconds = String(ms % 1000).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
};

// --- Helper: Formato de Fecha/Hora Legible ---
const formatTimestamp = (ts) => {
    if (!ts) return { date: 'N/A', time: 'N/A' };
    const dateObj = new Date(ts);
    return {
        date: dateObj.toLocaleDateString('es-AR'), // ej: 12/11/2025
        time: dateObj.toLocaleTimeString('es-AR', { hour12: false }), // ej: 08:35:01
    };
};

// --- Definición del Objeto de Entrada ---
const createNewEntry = (arrivalTimestamp) => ({
    id: arrivalTimestamp + '-' + Math.random().toString(36).substring(2, 9),
    // Tiempos (Timestamps)
    arrivalTimestamp: arrivalTimestamp, 	// A
    cashierStartTimestamp: null, 	 	// S1
    cashierEndTimestamp: null, 	 	// E1
    prepStartTimestamp: null, 	 	// S2
    prepEndTimestamp: null, 	 	// E2
    
    // Datos de Entrada
    iceCreamCategory: 'HELADO_BOCHAS', // Categoría inicial (por defecto)
    
    // Datos de Salida (Calculados)
    cashierWaitTimeMs: null, 	 // S1 - A
    cashierServiceTimeMs: null, 	// E1 - S1
    prepWaitTimeMs: null, 	 	// S2 - E1 (Será 0 si termina en caja)
    prepServiceTimeMs: null, 	// E2 - S2 (Será 0 si termina en caja)
    totalTimeInSystemMs: null, 	// E2 - A o E1 - A
    
    status: 'Esperando caja', // Estado para seguimiento de colas
});

// Categorías de helado actualizadas
const iceCreamCategories = [
    { value: 'HELADO_BOCHAS', label: 'Helado en Bochas (Necesita preparación)' },
    { value: 'PRODUCTO_HELADO', label: 'Producto Helado (Ej: Paleta, Bombón, TERMINA AQUÍ)' },
];


// --- Componente: Modal de Confirmación (Reemplaza window.confirm) ---
const ConfirmModal = ({ isOpen, message, onConfirm, onCancel }) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <p className="text-lg text-gray-800 mb-4">{message}</p>
                <div className="flex justify-end gap-3">
                    <button 
                        onClick={onCancel}
                        className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition"
                    >
                        Cancelar
                    </button>
                    <button 
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
                    >
                        Confirmar
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- Componente Principal de la App ---
const App = () => {
    // Estado de registros guardados
    const [dataEntries, setDataEntries] = useState([]);
    // Estado de clientes actualmente en el sistema
    const [activeEntries, setActiveEntries] = useState([]);
    // Estado de estadísticas (máximos en cola)
    const [stats, setStats] = useState({ maxCashierQueue: 0, maxPrepQueue: 0 });
    
    const [error, setError] = useState('');
    const [notification, setNotification] = useState(''); // Para mensajes de éxito
    const [isLoading, setIsLoading] = useState(true);

    // Estado del Modal
    const [modalState, setModalState] = useState({ 
        isOpen: false, 
        message: '', 
        onConfirm: () => {} 
    });
    
    // --- Carga Inicial de Datos y Stats ---
    useEffect(() => {
        setDataEntries(loadLocalData());
        setStats(loadLocalStats());
        setIsLoading(false);
    }, []);

    // --- Efecto para limpiar notificaciones ---
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(''), 3000);
            return () => clearTimeout(timer);
        }
    }, [notification]);
    
    // --- Efecto para limpiar errores ---
    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(''), 3000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    // --- EFECTO: Seguimiento de Colas ---
    useEffect(() => {
        // La cola de caja solo cuenta a los que están 'Esperando caja'
        const cashierQueueLen = activeEntries.filter(e => e.status === 'Esperando caja').length;
        // La cola de preparación solo cuenta a los que están 'Esperando preparación (o en cola)'
        const prepQueueLen = activeEntries.filter(e => e.status === 'Esperando preparación (o en cola)').length;

        let statsChanged = false;
        // Se debe copiar el estado para evitar mutaciones directas
        const newStats = { ...stats }; 
        
        if (cashierQueueLen > newStats.maxCashierQueue) {
            newStats.maxCashierQueue = cashierQueueLen;
            statsChanged = true;
        }
        if (prepQueueLen > newStats.maxPrepQueue) {
            newStats.maxPrepQueue = prepQueueLen;
            statsChanged = true;
        }

        if (statsChanged) {
            setStats(newStats);
            saveLocalStats(newStats); // Guardar stats actualizados
        }
        // Depender de 'activeEntries' y 'stats' para re-evaluar
    }, [activeEntries, stats]); 

    // --- LÓGICA DE EVENTOS (Ahora reciben un ID) ---

    // 1. Registrar Llegada (A) - Crea una nueva entrada activa
    const handleArrival = () => {
        const now = Date.now();
        const newEntry = createNewEntry(now);
        setActiveEntries(prev => [...prev, newEntry]);
        setError('');
    };

    // Función genérica para actualizar una entrada activa
    const updateActiveEntry = (id, updates) => {
        setActiveEntries(prev => 
            prev.map(entry => 
                entry.id === id ? { ...entry, ...updates } : entry
            )
        );
    };

    // 2. Inicio Servicio Caja (S1)
    const handleCashierStart = (id) => {
        const now = Date.now();
        const entry = activeEntries.find(e => e.id === id);
        if (!entry) return;
        
        const waitTime = now - entry.arrivalTimestamp;
        updateActiveEntry(id, {
            cashierStartTimestamp: now,
            cashierWaitTimeMs: waitTime,
            status: 'Caja en servicio',
        });
    };

    // 3. Fin Servicio Caja (E1) -> Punto de Decisión
    const handleCashierEnd = (id) => {
        const now = Date.now();
        const entry = activeEntries.find(e => e.id === id);
        if (!entry || !entry.cashierStartTimestamp) return;

        const serviceTime = now - entry.cashierStartTimestamp;
        
        let newStatus;
        let updates = {
            cashierEndTimestamp: now,
            cashierServiceTimeMs: serviceTime,
        };
        
        // --- LÓGICA DE DECISIÓN CLAVE ---
        if (entry.iceCreamCategory === 'PRODUCTO_HELADO') {
            // Caso 1: Producto Helado (TERMINA AQUÍ)
            updates = {
                ...updates,
                prepStartTimestamp: now, // Simulamos S2=E1 para cálculos
                prepEndTimestamp: now,   // Simulamos E2=E1 para cálculos
                prepWaitTimeMs: 0, 
                prepServiceTimeMs: 0,
                totalTimeInSystemMs: now - entry.arrivalTimestamp,
                status: 'Listo para guardar (Salida en Caja)',
            };
        } else {
            // Caso 2: Helado en Bochas (VA A PREPARACIÓN)
            updates = {
                ...updates,
                status: 'Esperando preparación (o en cola)',
            };
        }
        // -----------------------------
        
        updateActiveEntry(id, updates);
    };
    
    // 4. Inicio Servicio Preparación (S2)
    const handlePrepStart = (id) => {
        const now = Date.now();
        const entry = activeEntries.find(e => e.id === id);
        // Debe haber terminado caja y ser un producto que necesita preparación
        if (!entry || !entry.cashierEndTimestamp || entry.iceCreamCategory === 'PRODUCTO_HELADO') return;

        const prepWaitTime = now - entry.cashierEndTimestamp;
        updateActiveEntry(id, {
            prepStartTimestamp: now,
            prepWaitTimeMs: prepWaitTime,
            status: 'Preparación en servicio',
        });
    };

    // 5. Fin Servicio Preparación (E2)
    const handlePrepEnd = (id) => {
        const now = Date.now();
        const entry = activeEntries.find(e => e.id === id);
        // Debe haber comenzado preparación y no ser un producto que terminó en caja
        if (!entry || !entry.prepStartTimestamp || entry.iceCreamCategory === 'PRODUCTO_HELADO') return;
        
        const serviceTime = now - entry.prepStartTimestamp;
        const totalTime = now - entry.arrivalTimestamp;
        updateActiveEntry(id, {
            prepEndTimestamp: now,
            prepServiceTimeMs: serviceTime,
            totalTimeInSystemMs: totalTime,
            status: 'Listo para guardar (Salida)',
        });
    };

    // Cambio de Categoría (Ahora disponible para clientes en "Esperando caja" o "Caja en servicio")
    const handleCategoryChange = (id, newCategory) => {
        // Importante: No permitir cambiar la categoría si ya terminó la caja.
        const entry = activeEntries.find(e => e.id === id);
        if (entry && entry.cashierEndTimestamp) {
            setError("No se puede cambiar la categoría después de finalizar el servicio de caja (E1).");
            return;
        }
        updateActiveEntry(id, { iceCreamCategory: newCategory });
    };

    // 6. Guardar Registro
    const saveEntry = (id) => {
        const entryToSave = activeEntries.find(e => e.id === id);
        
        // El cliente está listo si:
        // 1. Es producto helado (debió haber completado E1, y el E2/S2 se llenó en handleCashierEnd)
        // 2. Es bochas y completó E2
        const isReadyToSave = (entryToSave && entryToSave.iceCreamCategory === 'PRODUCTO_HELADO' && entryToSave.cashierEndTimestamp) || 
                              (entryToSave && entryToSave.iceCreamCategory === 'HELADO_BOCHAS' && entryToSave.prepEndTimestamp);
        
        if (!isReadyToSave) {
            setError("Debe completar el flujo completo (Llegada a Fin Caja para Producto Helado, o a Fin Preparación para Bochas) para guardar.");
            return;
        }

        const recordToSave = {
            ...entryToSave,
            recordedAt: Date.now(),
        };

        // 1. Añadir a registros guardados y ordenar
        const newData = [recordToSave, ...dataEntries];
        const sortedData = newData.sort((a, b) => b.arrivalTimestamp - a.arrivalTimestamp);
        
        setDataEntries(sortedData);
        saveLocalData(sortedData);

        // 2. Eliminar de registros activos
        setActiveEntries(prev => prev.filter(entry => entry.id !== id));
        setError('');
        setNotification(`Registro ${id.split('-')[1]} guardado correctamente.`);
    };

    // --- Funciones del Modal ---
    
    const closeModal = () => {
        setModalState({ isOpen: false, message: '', onConfirm: () => {} });
    };

    // Cancelar Registro Actual
    const cancelEntry = (id) => {
        setModalState({
            isOpen: true,
            message: `¿Seguro que quieres cancelar el registro activo ${id.split('-')[1]}? No se guardará.`,
            onConfirm: () => {
                setActiveEntries(prev => prev.filter(entry => entry.id !== id));
                setError('');
                closeModal();
            }
        });
    };

    // Eliminar Registro Guardado
    const handleDeleteSaved = (id) => {
        setModalState({
            isOpen: true,
            message: `¿Seguro que quieres eliminar el registro ${id.split('-')[1]} de la base de datos local?`,
            onConfirm: () => {
                const newData = dataEntries.filter(entry => entry.id !== id);
                setDataEntries(newData);
                saveLocalData(newData);
                setError('');
                closeModal();
            }
        });
    };
    
    // Resetear Estadísticas de Colas
    const resetStats = () => {
        setModalState({
            isOpen: true,
            message: `¿Seguro que quieres reiniciar los contadores de "Máximo en Cola"?`,
            onConfirm: () => {
                const newStats = { maxCashierQueue: 0, maxPrepQueue: 0 };
                setStats(newStats);
                saveLocalStats(newStats);
                closeModal();
            }
        });
    };

    // FUNCIÓN PARA BORRAR TODO
    const confirmDeleteAllData = () => {
        setModalState({
            isOpen: true,
            message: `¿Seguro que quieres borrar todos los registros guardados?`,
            onConfirm: () => {
                // Limpiar LocalStorage
                try {
                    localStorage.removeItem(STORAGE_KEY_DATA);
                    localStorage.removeItem(STORAGE_KEY_STATS);
                } catch (e) {
                    setError("Error al borrar datos al limpiar el almacenamiento local");
                    console.error("Error al borrar localstorage:", e);
                }

                // Limpiar Estados
                setDataEntries([]);
                setStats({ maxCashierQueue: 0, maxPrepQueue: 0 });
                closeModal();
                setNotification("Todos los datos locales fueron borrados.");
            }
        });
    }

    // --- FUNCIÓN DE EXPORTACIÓN A EXCEL ---
    const exportToExcel = () => {
        if (dataEntries.length === 0) {
            setError("No hay datos para exportar.");
            return;
        }
        
        // Comprobar si XLSX está disponible (cargado desde el script)
        // Usamos 'window.XLSX' para ser explícitos
        if (typeof window.XLSX === 'undefined') {
            setError("La biblioteca de Excel (XLSX) no se ha cargado. Revisa la conexión o el script.");
            return;
        }

        // 1. Preparar Hoja 1: Registros Completos
        const headers1 = [
            'ID Cliente', 'Categoría Helado', 
            'Fecha Llegada', 'Hora Llegada', 
            'Timestamp Llegada (A)', 
            'Timestamp Inicio Caja (S1)', 
            'Timestamp Fin Caja (E1)', 
            'Timestamp Inicio Prep (S2)', 
            'Timestamp Fin Prep (E2)', 
            'Tiempo Espera Caja (ms)', 
            'Tiempo Servicio Caja (ms)', 
            'Tiempo Espera Prep (ms)', 
            'Tiempo Servicio Prep (ms)',
            'Tiempo Total Sistema (ms)',
        ];
        
        const formattedData = dataEntries.map(entry => {
            const llegada = formatTimestamp(entry.arrivalTimestamp);
            return {
                'ID Cliente': entry.id,
                'Categoría Helado': entry.iceCreamCategory,
                'Fecha Llegada': llegada.date,
                'Hora Llegada': llegada.time,
                'Timestamp Llegada (A)': entry.arrivalTimestamp,
                'Timestamp Inicio Caja (S1)': entry.cashierStartTimestamp,
                'Timestamp Fin Caja (E1)': entry.cashierEndTimestamp,
                'Timestamp Inicio Prep (S2)': entry.prepStartTimestamp,
                'Timestamp Fin Prep (E2)': entry.prepEndTimestamp,
                'Tiempo Espera Caja (ms)': entry.cashierWaitTimeMs,
                'Tiempo Servicio Caja (ms)': entry.cashierServiceTimeMs,
                'Tiempo Espera Prep (ms)': entry.prepWaitTimeMs,
                'Tiempo Servicio Prep (ms)': entry.prepServiceTimeMs,
                'Tiempo Total Sistema (ms)': entry.totalTimeInSystemMs,
            };
        });

        const ws1 = window.XLSX.utils.json_to_sheet(formattedData, { 
            header: headers1, 
            skipHeader: false 
        });
        
        window.XLSX.utils.sheet_add_aoa(ws1, [headers1], { origin: "A1" });

        const colWidths1 = headers1.map(h => ({ wch: Math.max(h.length, 22) }));
        ws1['!cols'] = colWidths1;

        // 2. Preparar Hoja 2: Resumen de Salidas
        const headers2 = ["Dato de Salida (Resumen)", "Valor"];
        const summaryData = [
            { "Dato de Salida (Resumen)": "Número Máx. Clientes en Cola de Caja", "Valor": stats.maxCashierQueue },
            { "Dato de Salida (Resumen)": "Número Máx. Clientes en Cola de Preparación", "Valor": stats.maxPrepQueue },
            { "Dato de Salida (Resumen)": "Número Total de Clientes Atendidos", "Valor": dataEntries.length }
        ];
        
        const ws2 = window.XLSX.utils.json_to_sheet(summaryData, { header: headers2, skipHeader: true });
        window.XLSX.utils.sheet_add_aoa(ws2, [headers2], { origin: "A1" });
        ws2['!cols'] = [{ wch: 45 }, { wch: 10 }];

        // 3. Crear y Descargar el Libro
        try {
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws1, "Registros Completos");
            window.XLSX.utils.book_append_sheet(wb, ws2, "Resumen de Salidas");
            
            const fileName = `Datos_Simulacion_Heladeria_${new Date().toISOString().split('T')[0]}.xlsx`;
            
            window.XLSX.writeFile(wb, fileName);
            
            setNotification("Datos exportados a Excel correctamente.");
        } catch (err) {
            console.error("Error al exportar a Excel:", err);
            setError("Error al generar el archivo Excel. Revisa la consola.");
        }
    };

    // --- Renderizado ---
    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen bg-gray-50">
                <p className="text-xl text-indigo-600 animate-pulse">Cargando aplicación offline...</p>
            </div>
        );
    }

    // Calcular colas actuales para mostrar en UI
    const cashierQueueLen = activeEntries.filter(e => e.status === 'Esperando caja').length;
    const prepQueueLen = activeEntries.filter(e => e.status === 'Esperando preparación (o en cola)').length;

    // Usamos React.Fragment (o <>) como contenedor principal
    return (
        <React.Fragment>
            
            {/* Modal de Confirmación */}
            <ConfirmModal
                isOpen={modalState.isOpen}
                message={modalState.message}
                onConfirm={modalState.onConfirm}
                onCancel={closeModal}
            />

            <header className="bg-indigo-700 text-white p-4 shadow-lg sticky top-0 z-10">
                <h1 className="text-2xl font-bold text-center">Registro de Colas (Multicliente)</h1>
                <p className="text-sm text-center opacity-80 mt-1">
                    Flujo: Llegada &rarr; Caja &rarr; Preparación / Salida
                </p>
            </header>

            <main className="p-4 flex-grow mobile-layout">
                
                {/* MENSAJE DE ERROR (Rojo) */}
                {error && (
                    <div className="p-4 mb-4 bg-red-100 border border-red-400 text-red-700 rounded-lg shadow-md">
                        <p className="font-bold">Error:</p>
                        <p>{error}</p>
                    </div>
                )}
                
                {/* MENSAJE DE NOTIFICACIÓN (Verde) */}
                {notification && (
                    <div className="p-4 mb-4 bg-green-100 border border-green-400 text-green-700 rounded-lg shadow-md">
                        <p className="font-bold">Aviso:</p>
                        <p>{notification}</p>
                    </div>
                )}
                
                {/* BOTÓN DE LLEGADA PRINCIPAL */}
                <div className="card mb-6">
                    <button
                        onClick={handleArrival}
                        className={`btn btn-primary btn-lg`}
                    >
                        1. Registrar LLEGADA (A) de Nuevo Cliente
                    </button>
                    <div className="grid grid-cols-2 gap-4 mt-4 text-center">
                        <div className="bg-gray-100 p-3 rounded-lg">
                            <p className="text-sm text-gray-600">Clientes en Cola Caja:</p>
                            <p className="text-2xl font-bold text-indigo-600">{cashierQueueLen}</p>
                        </div>
                        <div className="bg-gray-100 p-3 rounded-lg">
                            <p className="text-sm text-gray-600">Clientes en Cola Prep.:</p>
                            <p className="text-2xl font-bold text-yellow-600">{prepQueueLen}</p>
                        </div>
                    </div>
                </div>

                {/* SECCIÓN DE CLIENTES ACTIVOS */}
                <div className="mb-6">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">
                        Clientes Activos en el Sistema ({activeEntries.length})
                    </h2>
                    {activeEntries.length === 0 ? (
                        <p className="text-gray-500 italic text-center card p-6">
                            Esperando la llegada de clientes...
                        </p>
                    ) : (
                        <div className="space-y-4">
                            {/* Renderizar una tarjeta por cada cliente activo */}
                            {activeEntries.map(entry => (
                                <ActiveEntryCard
                                    key={entry.id}
                                    entry={entry}
                                    onCashierStart={handleCashierStart}
                                    onCashierEnd={handleCashierEnd}
                                    onPrepStart={handlePrepStart}
                                    onPrepEnd={handlePrepEnd}
                                    onCategoryChange={handleCategoryChange}
                                    onSave={saveEntry}
                                    onCancel={cancelEntry}
                                />
                            ))}
                        </div>
                    )}
                </div>
                
                {/* EXPORTAR Y DATOS DE SALIDA */}
                <div className="card mb-6">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">Datos Históricos (Salida E)</h2>
                    
                    <button
                        onClick={exportToExcel}
                        className={`btn btn-export bg-green-600 hover:bg-green-700 btn-lg`}
                    >
                        Exportar Datos a Excel (.xlsx) ({dataEntries.length} Registros)
                    </button>
                    
                    <p className="text-md text-gray-700 mt-4 font-semibold">
                        Resumen Histórico (Datos de Salida E):
                    </p>
                    <ul className="list-disc pl-5 mt-2 text-gray-600 text-sm space-y-2">
                        <li>
                            **Número Máx. Clientes en Cola de Caja:**
                            <span className="font-bold text-indigo-600 text-lg ml-2">{stats.maxCashierQueue}</span>
                        </li>
                        <li>
                            **Número Máx. Clientes en Cola de Preparación:**
                            <span className="font-bold text-yellow-600 text-lg ml-2">{stats.maxPrepQueue}</span>
                        </li>
                        <li>
                            **Número Total de Clientes Atendidos (Guardados):**
                            <span className="font-bold text-gray-700 text-lg ml-2">{dataEntries.length}</span>
                        </li>
                    </ul>
                    <button
                        onClick={resetStats}
                        className="text-xs text-red-500 hover:underline mt-3"
                    >
                        Reiniciar contadores de máx. en cola
                    </button>
                </div>

                {/* LISTA DE REGISTROS ALMACENADOS */}
                <div className="card">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">Registros Guardados ({dataEntries.length})</h2>
                    {dataEntries.length === 0 ? (
                        <p className="text-gray-500 italic text-center">Aún no hay registros de datos almacenados.</p>
                    ) : (
                        <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                            {dataEntries.map((entry) => (
                                <SavedEntryRow key={entry.id} entry={entry} onDelete={handleDeleteSaved} />
                            ))}
                        </div>
                    )}
                    {/* BOTÓN BORRAR DATOS */}
                    <button
                        onClick={confirmDeleteAllData}
                        className={`btn btn-delete bg-red-600 hover:bg-red-700 btn-lg mt-4`}
                    >
                        Borrar Datos Guardados
                    </button>
                </div>
            </main>
        </React.Fragment>
    );
};

// --- Sub-componente: Tarjeta de Cliente Activo ---
const ActiveEntryCard = ({
    entry, onCashierStart, onCashierEnd, onPrepStart, onPrepEnd, 
    onCategoryChange, onSave, onCancel 
}) => {
    
    const { 
        id, arrivalTimestamp, status, iceCreamCategory,
        cashierStartTimestamp, cashierEndTimestamp, prepStartTimestamp, prepEndTimestamp,
        cashierWaitTimeMs, cashierServiceTimeMs, prepWaitTimeMs, prepServiceTimeMs, totalTimeInSystemMs
    } = entry;

    const arrivalTime = formatTimestamp(arrivalTimestamp).time;
    const uniqueId = id.split('-')[1] || id; 
    
    // El cliente está listo si terminó en caja (producto helado) O terminó preparación (bochas)
    const isProductHelado = iceCreamCategory === 'PRODUCTO_HELADO';
    const isReadyToSave = (isProductHelado && !!cashierEndTimestamp) || (!!prepEndTimestamp);

    // Deshabilitar botones según el estado y el tipo de producto
    const canStartCashier = !cashierStartTimestamp;
    const canEndCashier = cashierStartTimestamp && !cashierEndTimestamp;
    
    const canChangeCategory = !cashierEndTimestamp; // Solo se puede cambiar antes de E1

    // Lógica condicional para Preparación
    const needsPreparation = iceCreamCategory === 'HELADO_BOCHAS';
    const isFinishedInCashier = isProductHelado && !!cashierEndTimestamp;
    
    const canStartPrep = needsPreparation && cashierEndTimestamp && !prepStartTimestamp;
    const canEndPrep = needsPreparation && prepStartTimestamp && !prepEndTimestamp;
    const canSave = isReadyToSave;


    // Determinar qué botón de SALIDA/Guardar mostrar:
    const showPrepButtons = needsPreparation;
    const showSaveAfterCashier = isProductHelado && !!cashierEndTimestamp;
    
    // Determinar el mensaje de estado
    let statusText = status;
    let statusColor = 'bg-yellow-100 text-yellow-700';
    if (isReadyToSave) {
        statusText = isProductHelado ? 'LISTO (Salió en Caja)' : 'LISTO (Salió en Preparación)';
        statusColor = 'bg-green-100 text-green-700';
    } else if (isFinishedInCashier) {
        statusText = 'Listo para guardar (Salida en Caja)';
        statusColor = 'bg-green-100 text-green-700';
    }


    return (
        <div className="card border-t-4 border-indigo-500">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-bold text-indigo-700">
                    Cliente <span className="font-mono text-base bg-indigo-100 px-2 py-0.5 rounded-md align-middle">{uniqueId}</span>
                </h3>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${statusColor}`}>
                    {statusText}
                </span>
            </div>
            <p className="text-xs text-gray-600 -mt-1 mb-3">
                Llegada: {arrivalTime}
            </p>

            {/* Selector de Categoría (Dato de Entrada D) */}
            <div className="mb-4">
                <label htmlFor={`category-${id}`} className="block text-sm font-medium text-gray-700 mb-1">
                    Categoría de Helado Solicitado:
                </label>
                <select
                    id={`category-${id}`}
                    value={iceCreamCategory}
                    onChange={(e) => onCategoryChange(id, e.target.value)}
                    className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md shadow-sm disabled:bg-gray-200"
                    disabled={!canChangeCategory} // Deshabilitar si ya terminó caja
                >
                    {iceCreamCategories.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </div>
            
            {/* Botones de Flujo */}
            <div className="space-y-2">
                {/* Botones de Caja */}
                <button onClick={() => onCashierStart(id)} disabled={!canStartCashier} className={`btn btn-secondary ${!canStartCashier ? 'btn-disabled' : ''}`}>
                    2. Iniciar Caja (S1)
                </button>
                <button onClick={() => onCashierEnd(id)} disabled={!canEndCashier} className={`btn btn-secondary ${!canEndCashier ? 'btn-disabled' : ''}`}>
                    3. Fin Caja (E1)
                </button>
                
                {/* Botones de Preparación (Solo si es Helado en Bochas) */}
                {showPrepButtons && (
                    <React.Fragment>
                        <hr className="my-2 border-dashed" />
                        <button onClick={() => onPrepStart(id)} disabled={!canStartPrep} className={`btn btn-secondary ${!canStartPrep ? 'btn-disabled' : ''}`}>
                            4. Iniciar Preparación (S2)
                        </button>
                        <button onClick={() => onPrepEnd(id)} disabled={!canEndPrep} className={`btn btn-secondary ${!canEndPrep ? 'btn-disabled' : ''}`}>
                            5. Fin Preparación / SALIDA (E2)
                        </button>
                    </React.Fragment>
                )}
                
                {/* Botón de Guardar (Se habilita si terminó en E1 o E2) */}
                {(showSaveAfterCashier || canSave) && (
                    <button onClick={() => onSave(id)} disabled={!canSave} className={`btn btn-success ${!canSave ? 'btn-disabled' : ''}`}>
                        6. Guardar Registro y Salida
                    </button>
                )}
                
                <button onClick={() => onCancel(id)} className="btn btn-danger bg-red-500 hover:bg-red-600">
                    Cancelar (No Guardar)
                </button>
            </div>

            {/* Tiempos de Salida (E) */}
            {(cashierWaitTimeMs !== null || prepWaitTimeMs !== null) && (
                <div className="mt-4 border-t pt-3">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Tiempos Acumulados (Datos E):</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        {cashierWaitTimeMs !== null && <TimeChip label="Espera Caja" time={cashierWaitTimeMs} color="indigo" />}
                        {cashierServiceTimeMs !== null && <TimeChip label="Servicio Caja" time={cashierServiceTimeMs} color="indigo" />}
                        {needsPreparation && prepWaitTimeMs !== null && <TimeChip label="Espera Prep." time={prepWaitTimeMs} color="yellow" />}
                        {needsPreparation && prepServiceTimeMs !== null && <TimeChip label="Servicio Prep." time={prepServiceTimeMs} color="yellow" />}
                        {!needsPreparation && isFinishedInCashier && <TimeChip label="Salida Inmediata" time={0} color="gray" />}
                    </div>
                    {totalTimeInSystemMs !== null && (
                        <div className="bg-green-100 p-2 rounded mt-2 text-center">
                            <p className="text-gray-700 font-medium text-xs">Tiempo Total en Sistema:</p>
                            <p className="font-mono text-base text-green-700 font-bold">{formatDuration(totalTimeInSystemMs)}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// --- Sub-componente: Chip de Tiempo (Corregido) ---
const TimeChip = ({ label, time, color }) => {
    // Corrección: Tailwind no puede construir clases dinámicamente.
    // Usamos clases estáticas basadas en el prop 'color'.
    let colorClasses = 'bg-gray-50 border-gray-400';
    if (color === 'indigo') {
        colorClasses = 'bg-indigo-50 border-indigo-400';
    } else if (color === 'yellow') {
        colorClasses = 'bg-yellow-50 border-yellow-400';
    }

    return (
        <div className={`p-2 rounded border-l-4 ${colorClasses}`}>
            <p className="text-gray-600 font-medium">{label}:</p>
            <p className="font-mono text-gray-900">{formatDuration(time)}</p>
        </div>
    );
};


// --- Sub-componente: Fila de Registro Guardado ---
const SavedEntryRow = ({ entry, onDelete }) => {
    const isProductHelado = entry.iceCreamCategory === 'PRODUCTO_HELADO';
    
    return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-sm">
            <div className="flex justify-between items-center mb-2">
                <p className="text-sm font-bold text-gray-700">
                    {entry.iceCreamCategory}
                    <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded-md align-middle ml-2">{entry.id.split('-')[1]}</span>
                </p>
                <button
                    onClick={() => onDelete(entry.id)}
                    className="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1 rounded-full bg-red-100"
                >
                    Eliminar
                </button>
            </div>
            <p className="text-xs text-gray-500 mb-2">
                Llegada: {formatTimestamp(entry.arrivalTimestamp).date} {formatTimestamp(entry.arrivalTimestamp).time}
            </p>
            <div className="grid grid-cols-2 gap-1 text-xs">
                <TimeChip label="Espera Caja" time={entry.cashierWaitTimeMs} color="indigo" />
                <TimeChip label="Servicio Caja" time={entry.cashierServiceTimeMs} color="indigo" />
                {!isProductHelado && <TimeChip label="Espera Prep." time={entry.prepWaitTimeMs} color="yellow" />}
                {!isProductHelado && <TimeChip label="Servicio Prep." time={entry.prepServiceTimeMs} color="yellow" />}
                {isProductHelado && <TimeChip label="Salida Inmediata" time={0} color="gray" />}
            </div>
            <div className="bg-green-100 p-2 rounded mt-2 text-center">
                <p className="text-gray-700 font-medium text-xs">Tiempo Total:</p>
                <p className="font-mono text-base text-green-700 font-bold">{formatDuration(entry.totalTimeInSystemMs)}</p>
            </div>
        </div>
    );
};


// --- Montar la Aplicación React ---
// Obtenemos el div 'root' del index.html
const root = ReactDOM.createRoot(document.getElementById('root'));
// Renderizamos el componente principal 'App'
root.render(<App />);